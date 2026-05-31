import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  userKeyphrasesTable,
  trustedDevicesTable,
  snapshotsTable,
  auditEventsTable,
} from "@workspace/db";
import { eq, and, gt, desc, gte } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { encryptText, decryptText } from "../lib/crypto-utils";
import { clerkClient } from "@clerk/express";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import bcrypt from "bcryptjs";
import { sha256Hex } from "../lib/field-crypto";
import { sensitiveEndpointLimiter } from "../lib/rate-limiter";
import { createSnapshot, restoreSnapshot } from "../lib/snapshot";
import { randomUUID } from "crypto";
import { lt } from "drizzle-orm";
import { recordAuditEvent } from "../lib/audit";

const router: IRouter = Router();

// ── In-memory device OTP challenge store ──────────────────────────────────────
// key: userId — one pending challenge per user at a time
interface DeviceChallenge {
  tokenHash: string;
  otp: string;
  expiresAt: number;
}
const pendingChallenges = new Map<string, DeviceChallenge>();

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function hasMfaEnabled(userId: string): Promise<boolean> {
  try {
    const user = await clerkClient.users.getUser(userId);
    return user.totpEnabled || user.backupCodeEnabled || (user.phoneNumbers?.some((p) => p.reservedForSecondFactor) ?? false);
  } catch {
    return false;
  }
}

async function getUserEmail(userId: string): Promise<string | null> {
  try {
    const user = await clerkClient.users.getUser(userId);
    return user.primaryEmailAddress?.emailAddress ?? null;
  } catch {
    return null;
  }
}

// ── Audit Log ──────────────────────────────────────────────────────────────────

/** Return the last 90 days of audit events for the authenticated user */
router.get("/security/audit-log", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const events = await db
      .select({
        id: auditEventsTable.id,
        action: auditEventsTable.action,
        metadata: auditEventsTable.metadata,
        ip: auditEventsTable.ip,
        createdAt: auditEventsTable.createdAt,
      })
      .from(auditEventsTable)
      .where(and(eq(auditEventsTable.userId, userId), gte(auditEventsTable.createdAt, since)))
      .orderBy(desc(auditEventsTable.createdAt))
      .limit(200);

    res.json(events);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch audit log");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Keyphrase ──────────────────────────────────────────────────────────────────

router.get("/security/keyphrase", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const [kp] = await db
      .select({ id: userKeyphrasesTable.id, createdAt: userKeyphrasesTable.createdAt })
      .from(userKeyphrasesTable)
      .where(eq(userKeyphrasesTable.userId, userId));

    const mfaEnabled = await hasMfaEnabled(userId);
    res.json({ hasKeyphrase: !!kp, mfaEnabled, createdAt: kp?.createdAt ?? null });
  } catch (err) {
    req.log.error({ err }, "Failed to get keyphrase status");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/security/keyphrase", requireAuth, sensitiveEndpointLimiter("keyphrase-set"), async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { keyphrase } = req.body as { keyphrase?: string };

    if (!keyphrase || keyphrase.trim().length < 6) {
      res.status(400).json({ error: "Keyphrase must be at least 6 characters" });
      return;
    }

    const mfaEnabled = await hasMfaEnabled(userId);
    if (!mfaEnabled) {
      res.status(403).json({
        error: "two_factor_required",
        message: "You must enable two-factor authentication before setting a keyphrase.",
      });
      return;
    }

    // Use argon2id for keyphrase storage — stronger than bcrypt against GPU cracking
    const argonHash = await argon2Hash(keyphrase);
    const encryptedPlaintext = encryptText(keyphrase);

    const [existing] = await db
      .select({ id: userKeyphrasesTable.id })
      .from(userKeyphrasesTable)
      .where(eq(userKeyphrasesTable.userId, userId));

    if (existing) {
      await db.update(userKeyphrasesTable).set({ bcryptHash: argonHash, encryptedPlaintext }).where(eq(userKeyphrasesTable.userId, userId));
    } else {
      await db.insert(userKeyphrasesTable).values({ userId, bcryptHash: argonHash, encryptedPlaintext });
    }

    recordAuditEvent(req, userId, "keyphrase_set", { updated: !!existing });

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to set keyphrase");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/security/keyphrase/verify", requireAuth, sensitiveEndpointLimiter("keyphrase-verify"), async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { keyphrase } = req.body as { keyphrase?: string };

    if (!keyphrase) {
      res.status(400).json({ error: "Keyphrase required" });
      return;
    }

    const [kp] = await db
      .select({ bcryptHash: userKeyphrasesTable.bcryptHash })
      .from(userKeyphrasesTable)
      .where(eq(userKeyphrasesTable.userId, userId));

    if (!kp) {
      res.json({ valid: true, hasKeyphrase: false });
      return;
    }

    // Support both argon2id (new) and bcrypt (legacy) stored hashes
    const valid = kp.bcryptHash.startsWith("$argon2")
      ? await argon2Verify(kp.bcryptHash, keyphrase)
      : await bcrypt.compare(keyphrase, kp.bcryptHash);

    recordAuditEvent(req, userId, "keyphrase_verified", { valid });

    res.json({ valid, hasKeyphrase: true });
  } catch (err) {
    req.log.error({ err }, "Failed to verify keyphrase");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Trusted Devices ────────────────────────────────────────────────────────────

/** List trusted devices for the authenticated user */
router.get("/security/devices", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const devices = await db
      .select({
        id: trustedDevicesTable.id,
        label: trustedDevicesTable.label,
        firstSeen: trustedDevicesTable.firstSeen,
        lastSeen: trustedDevicesTable.lastSeen,
        expiresAt: trustedDevicesTable.expiresAt,
      })
      .from(trustedDevicesTable)
      .where(and(eq(trustedDevicesTable.userId, userId), gt(trustedDevicesTable.expiresAt, new Date())))
      .orderBy(desc(trustedDevicesTable.lastSeen));

    res.json(devices);
  } catch (err) {
    req.log.error({ err }, "Failed to list trusted devices");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Issue a device OTP challenge.
 * Generates a device token and a 6-digit OTP.
 * If RESEND_API_KEY is configured, emails the OTP; otherwise returns it in the response
 * (development / no-email mode).
 */
router.post("/security/devices/challenge", requireAuth, sensitiveEndpointLimiter("device-challenge"), async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { label = "New Device" } = req.body as { label?: string };

    const deviceToken = randomUUID();
    const tokenHash = sha256Hex(deviceToken);
    const otp = generateOtp();
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

    pendingChallenges.set(userId, { tokenHash, otp, expiresAt });

    // Attempt email delivery via Resend if configured
    if (process.env.RESEND_API_KEY) {
      try {
        const email = await getUserEmail(userId);
        if (email) {
          const { Resend } = await import("resend");
          const resend = new Resend(process.env.RESEND_API_KEY);
          await resend.emails.send({
            from: "Memory Machine <noreply@memorymachine.app>",
            to: email,
            subject: "Device verification code",
            text: `Your verification code is: ${otp}\n\nThis code expires in 15 minutes. If you did not request this, ignore this email.`,
          });
        }
        res.json({ deviceToken, sent: true, label });
      } catch (emailErr) {
        req.log.warn({ emailErr }, "OTP email failed — returning OTP in response");
        res.json({ deviceToken, otp, sent: false, label });
      }
    } else {
      // No email configured: return OTP directly (dev mode / no RESEND_API_KEY)
      res.json({ deviceToken, otp, sent: false, label });
    }
  } catch (err) {
    req.log.error({ err }, "Failed to issue device challenge");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Verify OTP and register the device as trusted.
 * Expects the device token from the challenge step in cookie "mm_device" or
 * X-Device-Token header, and the OTP in the request body.
 */
router.post("/security/devices/verify", requireAuth, sensitiveEndpointLimiter("device-verify"), async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { otp, label = "Trusted Device", deviceToken: bodyToken } = req.body as {
      otp?: string;
      label?: string;
      deviceToken?: string;
    };

    if (!otp) {
      res.status(400).json({ error: "OTP required" });
      return;
    }

    const challenge = pendingChallenges.get(userId);
    if (!challenge || Date.now() > challenge.expiresAt) {
      pendingChallenges.delete(userId);
      res.status(400).json({ error: "No pending challenge or challenge expired. Request a new one." });
      return;
    }

    if (challenge.otp !== otp.trim()) {
      res.status(400).json({ error: "Invalid verification code" });
      return;
    }

    pendingChallenges.delete(userId);

    // Determine the device token to register:
    // Priority: bodyToken (from challenge response) → cookie → X-Device-Token header
    const rawToken =
      bodyToken ??
      req.cookies?.mm_device ??
      (req.headers["x-device-token"] as string | undefined) ??
      null;

    if (!rawToken) {
      res.status(400).json({ error: "Device token missing. Include deviceToken from the challenge response." });
      return;
    }

    const tokenHash = sha256Hex(rawToken);

    // Ensure hash matches the challenge
    if (tokenHash !== challenge.tokenHash) {
      res.status(400).json({ error: "Device token mismatch" });
      return;
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);

    // Upsert into trusted_devices
    await db
      .insert(trustedDevicesTable)
      .values({ userId, tokenHash, label, expiresAt })
      .onConflictDoUpdate({
        target: trustedDevicesTable.tokenHash,
        set: { label, lastSeen: new Date(), expiresAt },
      });

    // Set httpOnly cookie for web clients
    res.cookie("mm_device", rawToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 90 * 24 * 60 * 60 * 1000,
      path: "/",
    });

    recordAuditEvent(req, userId, "device_registered", { label });

    res.json({ success: true, label });
  } catch (err) {
    req.log.error({ err }, "Failed to verify device");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** Revoke a trusted device */
router.delete("/security/devices/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const deviceId = parseInt(String(req.params.id), 10);
    if (isNaN(deviceId)) {
      res.status(400).json({ error: "Invalid device ID" });
      return;
    }

    // Grab the label before deleting for the audit record
    const [device] = await db
      .select({ label: trustedDevicesTable.label })
      .from(trustedDevicesTable)
      .where(and(eq(trustedDevicesTable.id, deviceId), eq(trustedDevicesTable.userId, userId)));

    await db
      .delete(trustedDevicesTable)
      .where(and(eq(trustedDevicesTable.id, deviceId), eq(trustedDevicesTable.userId, userId)));

    if (device) {
      recordAuditEvent(req, userId, "device_revoked", { label: device.label });
    }

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to revoke device");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Snapshots ──────────────────────────────────────────────────────────────────

/** List snapshots for the authenticated user */
router.get("/security/snapshots", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const snaps = await db
      .select({
        id: snapshotsTable.id,
        label: snapshotsTable.label,
        sizeBytes: snapshotsTable.sizeBytes,
        createdAt: snapshotsTable.createdAt,
        expiresAt: snapshotsTable.expiresAt,
      })
      .from(snapshotsTable)
      .where(and(eq(snapshotsTable.userId, userId), gt(snapshotsTable.expiresAt, new Date())))
      .orderBy(desc(snapshotsTable.createdAt))
      .limit(20);

    res.json(snaps);
  } catch (err) {
    req.log.error({ err }, "Failed to list snapshots");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** Create a manual snapshot */
router.post("/security/snapshots", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { label = "Manual snapshot" } = req.body as { label?: string };

    const snap = await createSnapshot(userId, label);

    recordAuditEvent(req, userId, "snapshot_created", { label: snap.label, sizeBytes: snap.sizeBytes });

    res.json({
      id: snap.id,
      label: snap.label,
      sizeBytes: snap.sizeBytes,
      createdAt: snap.createdAt,
      expiresAt: snap.expiresAt,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create snapshot");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** Restore a snapshot — streams SSE progress */
router.post("/security/snapshots/:id/restore", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const snapshotId = parseInt(String(req.params.id), 10);
  if (isNaN(snapshotId)) {
    res.status(400).json({ error: "Invalid snapshot ID" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  try {
    await restoreSnapshot(userId, snapshotId, (msg) => {
      res.write(`data: ${msg}\n\n`);
    });
    recordAuditEvent(req, userId, "snapshot_restored", { snapshotId });
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (err) {
    req.log.error({ err }, "Snapshot restore failed");
    res.write(`data: ${JSON.stringify({ error: "Restore failed" })}\n\n`);
  }
  res.end();
});

/** Delete a snapshot */
router.delete("/security/snapshots/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const snapshotId = parseInt(String(req.params.id), 10);
    if (isNaN(snapshotId)) {
      res.status(400).json({ error: "Invalid snapshot ID" });
      return;
    }

    await db
      .delete(snapshotsTable)
      .where(and(eq(snapshotsTable.id, snapshotId), eq(snapshotsTable.userId, userId)));

    recordAuditEvent(req, userId, "snapshot_deleted", { snapshotId });

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete snapshot");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
