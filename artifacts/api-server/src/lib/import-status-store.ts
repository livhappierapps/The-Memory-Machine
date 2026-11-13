import { and, eq, sql } from "drizzle-orm";
import { db, importStatusesTable, type ImportStatusState } from "@workspace/db";

export interface ImportStatusUpdate {
  status: Exclude<ImportStatusState, "processing">;
  imported: number;
  skipped: number;
  errors: number;
  message?: string | null;
}

export async function ensureImportStatusSchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS import_statuses (
      id           serial PRIMARY KEY,
      user_id      text NOT NULL,
      upload_id    text NOT NULL,
      status       text NOT NULL CHECK (status IN ('processing', 'done', 'error')),
      imported     integer NOT NULL DEFAULT 0,
      skipped      integer NOT NULL DEFAULT 0,
      errors       integer NOT NULL DEFAULT 0,
      message      text,
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      CONSTRAINT import_statuses_user_upload_uq UNIQUE (user_id, upload_id)
    )
  `);
}

export async function beginImportStatus(userId: string, uploadId: string): Promise<boolean> {
  const created = await db
    .insert(importStatusesTable)
    .values({ userId, uploadId, status: "processing" })
    .onConflictDoNothing({
      target: [importStatusesTable.userId, importStatusesTable.uploadId],
    })
    .returning({ id: importStatusesTable.id });

  return created.length > 0;
}

export async function getImportStatusForOwner(userId: string, uploadId: string) {
  const [record] = await db
    .select()
    .from(importStatusesTable)
    .where(and(eq(importStatusesTable.userId, userId), eq(importStatusesTable.uploadId, uploadId)))
    .limit(1);
  return record ?? null;
}

export async function finishImportStatus(
  userId: string,
  uploadId: string,
  update: ImportStatusUpdate,
): Promise<void> {
  const rows = await db
    .update(importStatusesTable)
    .set({
      ...update,
      message: update.message ?? null,
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(
      and(
        eq(importStatusesTable.userId, userId),
        eq(importStatusesTable.uploadId, uploadId),
        eq(importStatusesTable.status, "processing"),
      ),
    )
    .returning({ id: importStatusesTable.id });

  if (rows.length === 0) {
    throw new Error("Import status was not in the processing state");
  }
}
