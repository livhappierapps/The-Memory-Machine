import { pgTable, text, serial, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const trustedDevicesTable = pgTable(
  "trusted_devices",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    label: text("label").notNull().default("Unknown Device"),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("trusted_devices_user_id_idx").on(t.userId)],
);

export const insertTrustedDeviceSchema = createInsertSchema(trustedDevicesTable).omit({
  id: true,
  firstSeen: true,
  lastSeen: true,
});

export type InsertTrustedDevice = z.infer<typeof insertTrustedDeviceSchema>;
export type TrustedDevice = typeof trustedDevicesTable.$inferSelect;
