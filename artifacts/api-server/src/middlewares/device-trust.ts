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

  if (raw && req.userId) {
    try {
      const hash = sha256Hex(raw);
      const now = new Date();
      const [device] = await db
        .select({ id: trustedDevicesTable.id })
        .from(trustedDevicesTable)
        .where(
          and(
            eq(trustedDevicesTable.tokenHash, hash),
            eq(trustedDevicesTable.userId, req.userId),
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
 * Only enforces when RESEND_API_KEY is configured (email can be sent).
 * Without email, the challenge can't be completed so we don't block.
 */
export function requireTrustedDevice(req: Request, res: Response, next: NextFunction): void {
  const emailConfigured = !!process.env.RESEND_API_KEY;
  if (!emailConfigured || req.deviceTrusted) {
    next();
    return;
  }
  res.status(403).json({
    error: "device_challenge_required",
    message: "This device is not recognized. Please verify your identity to continue.",
  });
}
