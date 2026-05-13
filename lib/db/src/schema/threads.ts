import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { profilesTable } from "./profiles";

export const threadsTable = pgTable("threads", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  profileId: integer("profile_id").references(() => profilesTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  archived: boolean("archived").notNull().default(false),
  pinned: boolean("pinned").notNull().default(false),
  model: text("model").notNull().default("grok-3"),
  messageCount: integer("message_count").notNull().default(0),
  memoryWeight: integer("memory_weight").notNull().default(0),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertThreadSchema = createInsertSchema(threadsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  messageCount: true,
  lastMessageAt: true,
});

export type InsertThread = z.infer<typeof insertThreadSchema>;
export type Thread = typeof threadsTable.$inferSelect;
