import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const snapshotsTable = pgTable(
  "snapshots",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    label: text("label").notNull().default("Auto"),
    snapshotData: text("snapshot_data").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("snapshots_user_id_idx").on(t.userId)],
);

export const insertSnapshotSchema = createInsertSchema(snapshotsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertSnapshot = z.infer<typeof insertSnapshotSchema>;
export type Snapshot = typeof snapshotsTable.$inferSelect;
