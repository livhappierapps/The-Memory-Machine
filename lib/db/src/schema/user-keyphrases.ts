import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userKeyphrasesTable = pgTable("user_keyphrases", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  bcryptHash: text("bcrypt_hash").notNull(),
  encryptedPlaintext: text("encrypted_plaintext").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserKeyphraseSchema = createInsertSchema(userKeyphrasesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUserKeyphrase = z.infer<typeof insertUserKeyphraseSchema>;
export type UserKeyphrase = typeof userKeyphrasesTable.$inferSelect;
