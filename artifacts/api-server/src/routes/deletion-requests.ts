import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { deletionRequestsTable, threadsTable, settingsTable } from "@workspace/db";
import { eq, and, isNull, isNotNull, lt, inArray, gte, lte } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { generateOtp, encryptText, signToken, verifySignedToken } from "../lib/crypto-utils";
import {
  sendEmail,
  deletionInitiatedEmail,
  deletionCancelledEmail,
  deletionLinkEmail,
  deletionConfirmedEmail,
  APP_URL,
} from "../lib/email";
import bcrypt from "bcryptjs";
import { clerkClient } from "@clerk/express";
import { randomUUID } from "crypto";

const router: IRouter = Router();

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const OTP_EXPIRY_MS = 15 * 60 * 1000;

type TargetType = "thread" | "date-range" | "history" | "account";

function getWaitMs(targetType: TargetType): number {
  if (targetType === "history" || targetType === "account") {
    return 14 * 24 * 60 * 60 * 1000;
  }
  return 24 * 60 * 60 * 1000;
}

async function getUserEmail(userId: string): Promise<string | null> {
  try {
    const user = await clerkClient.users.getUser(userId);
    const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
    return primary?.emailAddress ?? null;
  } catch {
    return null;
  }
}

async function hasMfaEnabled(userId: string): Promise<boolean> {
  try {
    const user = await clerkClient.users.getUser(userId);
    return user.totpEnabled || user.backupCodeEnabled || (user.phoneNumbers?.some((p) => p.reservedForSecondFactor) ?? false);
  } catch {
    return false;
  }
}

router.post("/deletion-requests", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { targetType, targetIds, dateFrom, dateTo } = req.body as {
      targetType: TargetType;
      targetIds?: number[];
      dateFrom?: string;
      dateTo?: string;
    };

    if (!["thread", "date-range", "history", "account"].includes(targetType)) {
      res.status(400).json({ error: "Invalid targetType" });
      return;
    }

    const mfaEnabled = await hasMfaEnabled(userId);
    if (!mfaEnabled) {
      res.status(403).json({
        error: "two_factor_required",
        message: "Two-factor authentication must be enabled on your account before you can delete data. Go to your Clerk account settings to enable it.",
      });
      return;
    }

    const existingPending = await db
      .select({ id: deletionRequestsTable.id })
      .from(deletionRequestsTable)
      .where(
        and(
          eq(deletionRequestsTable.userId, userId),
          eq(deletionRequestsTable.status, "pending_otp"),
        ),
      )
      .limit(1);

    if (existingPending.length > 0) {
      res.status(409).json({ error: "A deletion request is already in progress. Cancel it first." });
      return;
    }

    if (targetType === "thread" && Array.isArray(targetIds) && targetIds.length > 0) {
      for (const threadId of targetIds) {
        const [thread] = await db
          .select({ createdAt: threadsTable.createdAt })
          .from(threadsTable)
          .where(and(eq(threadsTable.id, threadId), eq(threadsTable.userId, userId)));

        if (thread && Date.now() - thread.createdAt.getTime() < THIRTY_DAYS_MS) {
          res.status(403).json({
            error: "recency_lock",
            message: "Conversations created within the last 30 days cannot be deleted. This lock protects your recent data.",
          });
          return;
        }
      }
    }

    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 12);
    const cancelToken = randomUUID();
    const waitMs = getWaitMs(targetType);
    const executeAfter = new Date(Date.now() + waitMs);

    const [request] = await db
      .insert(deletionRequestsTable)
      .values({
        userId,
        targetType,
        targetIds: targetIds ?? null,
        dateFrom: dateFrom ?? null,
        dateTo: dateTo ?? null,
        status: "pending_otp",
        executeAfter,
        otpHash,
        cancelToken,
      })
      .returning();

    const userEmail = await getUserEmail(userId);
    if (userEmail) {
      const cancelUrl = `${APP_URL}/api/deletion-requests/${request.id}/cancel-link?token=${cancelToken}`;
      const emailContent = deletionInitiatedEmail({
        otp,
        targetType,
        dateFrom,
        dateTo,
        cancelUrl,
        waitHours: waitMs / 3600000,
      });
      await sendEmail({ to: userEmail, ...emailContent });
    }

    res.status(201).json({
      id: request.id,
      status: request.status,
      executeAfter: request.executeAfter,
      emailSent: !!userEmail,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create deletion request");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/deletion-requests/:id/confirm-otp", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const id = parseInt(req.params.id as string, 10);
    const { otp, keyphrase } = req.body as { otp: string; keyphrase?: string };

    const [request] = await db
      .select()
      .from(deletionRequestsTable)
      .where(and(eq(deletionRequestsTable.id, id), eq(deletionRequestsTable.userId, userId)));

    if (!request) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    if (request.status !== "pending_otp") {
      res.status(409).json({ error: "Request is not in pending_otp state" });
      return;
    }
    if (Date.now() - request.createdAt.getTime() > OTP_EXPIRY_MS) {
      await db.update(deletionRequestsTable).set({ status: "cancelled" }).where(eq(deletionRequestsTable.id, id));
      res.status(410).json({ error: "OTP expired. Please start a new deletion request." });
      return;
    }
    if (!request.otpHash || !(await bcrypt.compare(otp, request.otpHash))) {
      res.status(400).json({ error: "Invalid verification code" });
      return;
    }

    const { db: dbImport, userKeyphrasesTable } = await import("@workspace/db");
    const [kp] = await dbImport
      .select({ bcryptHash: userKeyphrasesTable.bcryptHash })
      .from(userKeyphrasesTable)
      .where(eq(userKeyphrasesTable.userId, userId));

    if (kp) {
      if (!keyphrase) {
        res.status(403).json({ error: "keyphrase_required", message: "Your keyphrase is required to confirm deletion." });
        return;
      }
      const keyphraseMatch = await bcrypt.compare(keyphrase, kp.bcryptHash);
      if (!keyphraseMatch) {
        res.status(400).json({ error: "Invalid keyphrase" });
        return;
      }
    }

    const signedPayload = `${request.id}:${request.executeAfter.toISOString()}`;
    const sig = signToken(signedPayload);
    const signedToken = `${Buffer.from(signedPayload).toString("base64")}.${sig}`;
    const cancelToken = request.cancelToken ?? randomUUID();

    await db.update(deletionRequestsTable)
      .set({ status: "awaiting_link", signedToken, otpHash: null })
      .where(eq(deletionRequestsTable.id, id));

    const userEmail = await getUserEmail(userId);
    if (userEmail) {
      const executeUrl = `${APP_URL}/api/deletion-requests/${request.id}/execute-link?token=${encodeURIComponent(signedToken)}`;
      const cancelUrl = `${APP_URL}/api/deletion-requests/${request.id}/cancel-link?token=${cancelToken}`;
      const emailContent = deletionLinkEmail({
        targetType: request.targetType,
        executeAt: request.executeAfter.toISOString(),
        executeUrl,
        cancelUrl,
      });

      const waitMs = getWaitMs(request.targetType as TargetType);
      const delayMs = Math.max(0, request.executeAfter.getTime() - Date.now());

      if (delayMs > 0) {
        setTimeout(async () => {
          await sendEmail({ to: userEmail, ...emailContent });
        }, delayMs);
      } else {
        await sendEmail({ to: userEmail, ...emailContent });
      }
    }

    res.json({ status: "awaiting_link", executeAfter: request.executeAfter });
  } catch (err) {
    req.log.error({ err }, "Failed to confirm OTP");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/deletion-requests/:id/cancel", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const id = parseInt(req.params.id as string, 10);

    const [request] = await db
      .select()
      .from(deletionRequestsTable)
      .where(and(eq(deletionRequestsTable.id, id), eq(deletionRequestsTable.userId, userId)));

    if (!request) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    if (["cancelled", "executed"].includes(request.status)) {
      res.status(409).json({ error: "Request already completed" });
      return;
    }

    await db.update(deletionRequestsTable).set({ status: "cancelled" }).where(eq(deletionRequestsTable.id, id));

    const userEmail = await getUserEmail(userId);
    if (userEmail) {
      const emailContent = deletionCancelledEmail({ targetType: request.targetType });
      await sendEmail({ to: userEmail, ...emailContent });
    }

    res.json({ status: "cancelled" });
  } catch (err) {
    req.log.error({ err }, "Failed to cancel deletion request");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/deletion-requests/pending", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;

    const [request] = await db
      .select({
        id: deletionRequestsTable.id,
        status: deletionRequestsTable.status,
        targetType: deletionRequestsTable.targetType,
        dateFrom: deletionRequestsTable.dateFrom,
        dateTo: deletionRequestsTable.dateTo,
        executeAfter: deletionRequestsTable.executeAfter,
      })
      .from(deletionRequestsTable)
      .where(
        and(
          eq(deletionRequestsTable.userId, userId),
          eq(deletionRequestsTable.status, "awaiting_link"),
        ),
      )
      .limit(1);

    res.json(request ?? null);
  } catch (err) {
    req.log.error({ err }, "Failed to get pending deletion request");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/deletion-requests/:id/execute-link", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const id = parseInt(req.params.id as string, 10);
    const token = req.query.token as string;

    const [request] = await db
      .select()
      .from(deletionRequestsTable)
      .where(and(eq(deletionRequestsTable.id, id), eq(deletionRequestsTable.userId, userId)));

    if (!request || request.status !== "awaiting_link") {
      res.status(404).json({ error: "Request not found or not ready" });
      return;
    }

    if (token !== request.signedToken) {
      res.status(403).json({ error: "Invalid token" });
      return;
    }

    if (new Date() < request.executeAfter) {
      res.status(425).json({
        error: "too_early",
        message: "The waiting period has not elapsed yet.",
        executeAfter: request.executeAfter,
      });
      return;
    }

    const newOtp = generateOtp();
    const newOtpHash = await bcrypt.hash(newOtp, 12);
    await db.update(deletionRequestsTable)
      .set({ status: "awaiting_final_otp", otpHash: newOtpHash })
      .where(eq(deletionRequestsTable.id, id));

    const userEmail = await getUserEmail(userId);
    if (userEmail) {
      const emailContent = deletionInitiatedEmail({
        otp: newOtp,
        targetType: request.targetType,
        dateFrom: request.dateFrom,
        dateTo: request.dateTo,
        cancelUrl: `${APP_URL}/api/deletion-requests/${id}/cancel-link?token=${request.cancelToken}`,
        waitHours: 0,
      });
      await sendEmail({ to: userEmail, ...emailContent });
    }

    res.json({ status: "awaiting_final_otp", emailSent: !!userEmail });
  } catch (err) {
    req.log.error({ err }, "Failed to initiate final OTP");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/deletion-requests/:id/execute-final", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const id = parseInt(req.params.id as string, 10);
    const { otp } = req.body as { otp: string };

    const [request] = await db
      .select()
      .from(deletionRequestsTable)
      .where(and(eq(deletionRequestsTable.id, id), eq(deletionRequestsTable.userId, userId)));

    if (!request || request.status !== "awaiting_final_otp") {
      res.status(404).json({ error: "Request not found or not in final OTP state" });
      return;
    }
    if (!request.otpHash || !(await bcrypt.compare(otp, request.otpHash))) {
      res.status(400).json({ error: "Invalid verification code" });
      return;
    }

    await db.update(deletionRequestsTable).set({ status: "executed", otpHash: null }).where(eq(deletionRequestsTable.id, id));

    const now = new Date();

    if (request.targetType === "thread") {
      const ids = (request.targetIds ?? []) as number[];
      if (ids.length > 0) {
        await db
          .update(threadsTable)
          .set({ deletedAt: now })
          .where(and(eq(threadsTable.userId, userId), inArray(threadsTable.id, ids), isNull(threadsTable.deletedAt)));
      }
    } else if (request.targetType === "date-range") {
      const conditions = [eq(threadsTable.userId, userId), isNull(threadsTable.deletedAt)];
      if (request.dateFrom) {
        conditions.push(gte(threadsTable.createdAt, new Date(request.dateFrom)));
      }
      if (request.dateTo) {
        conditions.push(lte(threadsTable.createdAt, new Date(request.dateTo + "T23:59:59Z")));
      }
      await db.update(threadsTable).set({ deletedAt: now }).where(and(...conditions));
    } else if (request.targetType === "history") {
      await db
        .update(threadsTable)
        .set({ deletedAt: now })
        .where(and(eq(threadsTable.userId, userId), isNull(threadsTable.deletedAt)));
    } else if (request.targetType === "account") {
      await db
        .update(threadsTable)
        .set({ deletedAt: now })
        .where(and(eq(threadsTable.userId, userId), isNull(threadsTable.deletedAt)));
    }

    const userEmail = await getUserEmail(userId);
    if (userEmail) {
      const emailContent = deletionConfirmedEmail({ targetType: request.targetType });
      await sendEmail({ to: userEmail, ...emailContent });
    }

    res.json({ status: "executed" });
  } catch (err) {
    req.log.error({ err }, "Failed to execute deletion");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/deletion-requests/:id/cancel-link", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const token = req.query.token as string;

    const [request] = await db
      .select()
      .from(deletionRequestsTable)
      .where(eq(deletionRequestsTable.id, id));

    if (!request || request.cancelToken !== token) {
      res.status(403).send(`<html><body style="font-family:system-ui;background:#1a1a22;color:#e0e0e0;text-align:center;padding:80px">
        <h2 style="color:#e53e3e">Invalid or expired cancellation link</h2>
        <p>This link may have already been used.</p>
        <a href="${APP_URL}" style="color:#1ad4be">Return to Memory Machine</a></body></html>`);
      return;
    }

    if (["cancelled", "executed"].includes(request.status)) {
      res.send(`<html><body style="font-family:system-ui;background:#1a1a22;color:#e0e0e0;text-align:center;padding:80px">
        <h2 style="color:#1ad4be">Already ${request.status}</h2>
        <a href="${APP_URL}" style="color:#1ad4be">Return to Memory Machine</a></body></html>`);
      return;
    }

    await db.update(deletionRequestsTable).set({ status: "cancelled" }).where(eq(deletionRequestsTable.id, id));

    const userEmail = await getUserEmail(request.userId);
    if (userEmail) {
      const emailContent = deletionCancelledEmail({ targetType: request.targetType });
      await sendEmail({ to: userEmail, ...emailContent });
    }

    res.send(`<html><body style="font-family:system-ui;background:#1a1a22;color:#e0e0e0;text-align:center;padding:80px">
      <h2 style="color:#1ad4be">Deletion cancelled</h2>
      <p>Your data is safe. The deletion request has been cancelled.</p>
      <a href="${APP_URL}" style="color:#1ad4be">Return to Memory Machine</a></body></html>`);
  } catch (err) {
    req.log.error({ err }, "Failed to cancel via link");
    res.status(500).send("Error");
  }
});

export async function purgeExpiredSoftDeletes() {
  try {
    const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);
    const deleted = await db
      .delete(threadsTable)
      .where(and(lt(threadsTable.deletedAt, cutoff), isNotNull(threadsTable.deletedAt)))
      .returning({ id: threadsTable.id });
    if (deleted.length > 0) {
      const { logger: log } = await import("../lib/logger");
      log.info({ count: deleted.length }, "Purged soft-deleted threads older than 30 days");
    }
  } catch (_err) {
    /* non-fatal */
  }
}

export default router;
