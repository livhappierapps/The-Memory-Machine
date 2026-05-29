import { pgTable, text, serial, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const deletionRequestsTable = pgTable("deletion_requests", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  targetType: text("target_type").notNull(),
  targetIds: jsonb("target_ids").$type<number[]>(),
  dateFrom: text("date_from"),
  dateTo: text("date_to"),
  status: text("status").notNull().default("pending_otp"),
  executeAfter: timestamp("execute_after", { withTimezone: true }).notNull(),
  otpHash: text("otp_hash"),
  signedToken: text("signed_token"),
  cancelToken: text("cancel_token"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDeletionRequestSchema = createInsertSchema(deletionRequestsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertDeletionRequest = z.infer<typeof insertDeletionRequestSchema>;
export type DeletionRequest = typeof deletionRequestsTable.$inferSelect;
