/**
 * Device trust middleware.
 *
 * Reads a device token from either:
 *   - httpOnly cookie "mm_device" (web)
 *   - X-Device-Token request header (mobile / API)
 *
 * Hashes the token with SHA-256 and looks up in trusted_devices.
 * Sets req.deviceTrusted (boolean) and req.deviceTokenRaw (string | null).
 *
 * Does NOT block requests — call requireTrustedDevice after this middleware
 * on destructive endpoints.
 */

import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { trustedDevicesTable } from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";
import { sha256Hex } from "../lib/field-crypto";
import { getAuth } from "@clerk/express";

declare global {
  namespace Express {
    interface Request {
      deviceTrusted: boolean;
      deviceTokenRaw: string | null;
    }
  }
}

export async function deviceTrustMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const raw: string | null =
    req.cookies?.mm_device ??
    (req.headers["x-device-token"] as string | undefined) ??
    null;

  req.deviceTokenRaw = raw;
  req.deviceTrusted = false;

  // getAuth resolves Clerk session without depending on requireAuth having run first
  const userId = getAuth(req).userId ?? req.userId ?? null;

  if (raw && userId) {
    try {
      const hash = sha256Hex(raw);
      const now = new Date();
      const [device] = await db
        .select({ id: trustedDevicesTable.id })
        .from(trustedDevicesTable)
        .where(
          and(
            eq(trustedDevicesTable.tokenHash, hash),
            eq(trustedDevicesTable.userId, userId),
            gt(trustedDevicesTable.expiresAt, now),
          ),
        );
      req.deviceTrusted = !!device;
      if (device) {
        await db
          .update(trustedDevicesTable)
          .set({ lastSeen: now })
          .where(eq(trustedDevicesTable.id, device.id));
      }
    } catch {
      // non-blocking — proceed as untrusted
    }
  }

  next();
}

/**
 * Middleware that blocks untrusted devices on destructive endpoints.
 * Fails closed: if email is not configured, returns 503 instead of allowing through.
 */
export function requireTrustedDevice(req: Request, res: Response, next: NextFunction): void {
  if (req.deviceTrusted) {
    next();
    return;
  }
  if (!process.env.RESEND_API_KEY) {
    res.status(503).json({
      error: "device_trust_misconfigured",
      message: "Device trust enforcement requires RESEND_API_KEY to be configured.",
    });
    return;
  }
  res.status(403).json({
    error: "device_challenge_required",
    message: "This device is not recognized. Please verify your identity to continue.",
  });
}
