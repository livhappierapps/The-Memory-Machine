import { pgTable, text, serial, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const AUDIT_ACTIONS = [
  "sign_in",
  "keyphrase_set",
  "keyphrase_verified",
  "device_registered",
  "device_revoked",
  "snapshot_created",
  "snapshot_restored",
  "snapshot_deleted",
  "deletion_requested",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const auditEventsTable = pgTable(
  "audit_events",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    action: text("action").notNull().$type<AuditAction>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_events_user_id_idx").on(t.userId),
    index("audit_events_created_at_idx").on(t.createdAt),
  ],
);

export type AuditEvent = typeof auditEventsTable.$inferSelect;

export const auditEventSchema = z.object({
  id: z.number(),
  userId: z.string(),
  action: z.enum(AUDIT_ACTIONS),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  ip: z.string().nullable(),
  createdAt: z.string(),
});
