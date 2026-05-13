import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const profilesTable = pgTable("profiles", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  emoji: text("emoji").notNull().default("🤖"),
  color: text("color").notNull().default("#2dd4bf"),
  personalityNotes: text("personality_notes"),
  apiKey: text("api_key"),
  defaultModel: text("default_model").notNull().default("grok-3"),
  maxContextMessages: integer("max_context_messages").notNull().default(100),
  // Memory engine settings
  smartRetrieval: boolean("smart_retrieval").notNull().default(true),
  topNMemories: integer("top_n_memories").notNull().default(10),
  alwaysIncludeLastN: integer("always_include_last_n").notNull().default(3),
  memoryDateFrom: text("memory_date_from"),
  memoryDateTo: text("memory_date_to"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProfileSchema = createInsertSchema(profilesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type Profile = typeof profilesTable.$inferSelect;
