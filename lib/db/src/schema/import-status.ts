import { integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export type ImportStatusState = "processing" | "done" | "error";

export const importStatusesTable = pgTable(
  "import_statuses",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    uploadId: text("upload_id").notNull(),
    status: text("status").$type<ImportStatusState>().notNull(),
    imported: integer("imported").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    errors: integer("errors").notNull().default(0),
    message: text("message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("import_statuses_user_upload_uq").on(table.userId, table.uploadId),
  ],
);

export type ImportStatusRecord = typeof importStatusesTable.$inferSelect;
