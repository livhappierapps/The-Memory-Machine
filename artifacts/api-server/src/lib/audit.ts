import { db } from "@workspace/db";
import { auditEventsTable, type AuditAction } from "@workspace/db";
import type { Request } from "express";

/**
 * Record a security audit event. Fire-and-forget — never throws.
 */
export function recordAuditEvent(
  req: Request,
  userId: string,
  action: AuditAction,
  metadata?: Record<string, unknown>,
): void {
  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
    req.ip ??
    null;

  db.insert(auditEventsTable)
    .values({ userId, action, metadata: metadata ?? null, ip })
    .catch((err) => {
      req.log?.warn({ err, action }, "Failed to record audit event");
    });
}
