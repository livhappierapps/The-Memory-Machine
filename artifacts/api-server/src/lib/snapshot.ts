/**
 * Snapshot engine — create and restore per-user data snapshots.
 *
 * A snapshot serializes all threads + decrypted message content to JSON,
 * then re-encrypts the blob with the per-user field key before storing.
 * This means the snapshot is encrypted at rest with the same key derivation
 * as individual fields, and can only be decrypted for the owning user.
 */

import { db } from "@workspace/db";
import {
  threadsTable,
  messagesTable,
  snapshotsTable,
} from "@workspace/db";
import { eq, and, isNull, asc } from "drizzle-orm";
import { encryptField, decryptField } from "./field-crypto";
import { logger } from "./logger";

const SNAPSHOT_TTL_DAYS = 90;
const RESTORE_BATCH = 50;

interface SnapshotThread {
  title: string;
  model: string | null;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  messages: Array<{
    role: string;
    content: string;
    isSummary: boolean;
    createdAt: string;
  }>;
}

interface SnapshotPayload {
  version: 1;
  userId: string;
  createdAt: string;
  threads: SnapshotThread[];
}

/** Create a snapshot for a user and return the stored row. */
export async function createSnapshot(
  userId: string,
  label = "Auto",
): Promise<typeof snapshotsTable.$inferSelect> {
  const threads = await db
    .select()
    .from(threadsTable)
    .where(and(eq(threadsTable.userId, userId), isNull(threadsTable.deletedAt)));

  const snapshotThreads: SnapshotThread[] = [];

  for (const thread of threads) {
    const msgs = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.threadId, thread.id))
      .orderBy(asc(messagesTable.createdAt));

    snapshotThreads.push({
      title: thread.title,
      model: thread.model,
      pinned: thread.pinned,
      archived: thread.archived,
      createdAt: thread.createdAt.toISOString(),
      messages: msgs.map((m) => ({
        role: m.role,
        content: decryptField(userId, m.content),
        isSummary: m.isSummary,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  }

  const payload: SnapshotPayload = {
    version: 1,
    userId,
    createdAt: new Date().toISOString(),
    threads: snapshotThreads,
  };

  const plainJson = JSON.stringify(payload);
  const encryptedBlob = encryptField(userId, plainJson);
  const sizeBytes = Buffer.byteLength(encryptedBlob, "utf8");

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SNAPSHOT_TTL_DAYS);

  const [row] = await db
    .insert(snapshotsTable)
    .values({
      userId,
      label,
      snapshotData: encryptedBlob,
      sizeBytes,
      expiresAt,
    })
    .returning();

  return row!;
}

/**
 * Restore a snapshot. Threads are re-imported with a "(Restored YYYY-MM-DD)" title prefix.
 * Existing data is NOT overwritten — restored threads are additions.
 * Calls onProgress with status strings for SSE streaming.
 */
export async function restoreSnapshot(
  userId: string,
  snapshotId: number,
  onProgress: (msg: string) => void,
): Promise<void> {
  const [snap] = await db
    .select()
    .from(snapshotsTable)
    .where(and(eq(snapshotsTable.id, snapshotId), eq(snapshotsTable.userId, userId)));

  if (!snap) throw new Error("Snapshot not found");

  const plainJson = decryptField(userId, snap.snapshotData);
  const payload: SnapshotPayload = JSON.parse(plainJson) as SnapshotPayload;

  const dateLabel = new Date().toISOString().slice(0, 10);
  let restored = 0;

  for (let i = 0; i < payload.threads.length; i += RESTORE_BATCH) {
    const batch = payload.threads.slice(i, i + RESTORE_BATCH);

    for (const t of batch) {
      const [newThread] = await db
        .insert(threadsTable)
        .values({
          userId,
          title: `(Restored ${dateLabel}) ${t.title}`,
          model: t.model ?? "grok-3",
          pinned: false,
          archived: false,
          messageCount: t.messages.length,
        })
        .returning();

      if (t.messages.length > 0) {
        await db.insert(messagesTable).values(
          t.messages.map((m) => ({
            threadId: newThread!.id,
            role: m.role as "user" | "assistant" | "system",
            content: encryptField(userId, m.content),
            isSummary: m.isSummary,
            createdAt: new Date(m.createdAt),
          })),
        );
      }

      restored++;
    }

    onProgress(
      JSON.stringify({
        restored,
        total: payload.threads.length,
        pct: Math.round((restored / payload.threads.length) * 100),
      }),
    );
  }

  logger.info({ userId, snapshotId, restored }, "Snapshot restore complete");
}

/** Purge snapshots older than their expiresAt date. */
export async function purgeExpiredSnapshots(): Promise<void> {
  try {
    const { lt } = await import("drizzle-orm");
    await db.delete(snapshotsTable).where(lt(snapshotsTable.expiresAt, new Date()));
  } catch (err) {
    logger.warn({ err }, "Failed to purge expired snapshots");
  }
}

/** Run weekly snapshots for all users who have threads. */
export async function runWeeklySnapshots(): Promise<void> {
  try {
    const users = await db
      .selectDistinct({ userId: threadsTable.userId })
      .from(threadsTable)
      .where(isNull(threadsTable.deletedAt));

    for (const { userId } of users) {
      try {
        await createSnapshot(userId, "Weekly auto-snapshot");
        logger.info({ userId }, "Weekly snapshot created");
      } catch (err) {
        logger.warn({ err, userId }, "Weekly snapshot failed for user");
      }
    }
  } catch (err) {
    logger.warn({ err }, "runWeeklySnapshots failed");
  }
}
