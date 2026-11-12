/**
 * Live-DB tests for the backfill:embeddings script. The provider call is
 * mocked; storeEmbedding is real so DB writes are verified.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/embeddings.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/embeddings.js")>();
  return { ...original, generateEmbeddingResult: vi.fn() };
});

import { db, threadsTable, messagesTable, profilesTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { encryptField } from "../lib/field-crypto.js";
import { generateEmbeddingResult } from "../lib/embeddings.js";
import { createRateLimiter, parseArgs, runBackfill } from "../scripts/backfill-embeddings.js";

const USER = "test-user-backfill-embeddings";
const vector = Array.from({ length: 1536 }, () => 1 / Math.sqrt(1536));
let threadId: number;
let deletedThreadId: number;
let messageIds: number[] = [];
const base = parseArgs(["--user", USER, "--rps", "1000", "--no-reindex", "--no-threads"]);
const prevKey = process.env.XAI_API_KEY;

beforeAll(async () => {
  const [profile] = await db.insert(profilesTable).values({
    userId: USER, name: "Backfill", emoji: "🧪", color: "#000000",
  }).returning({ id: profilesTable.id });
  const [t] = await db.insert(threadsTable).values({
    userId: USER, profileId: profile!.id, title: "backfill thread", model: "grok-3",
  }).returning({ id: threadsTable.id });
  threadId = t!.id;
  const [d] = await db.insert(threadsTable).values({
    userId: USER, profileId: profile!.id, title: "deleted thread", model: "grok-3", deletedAt: new Date(),
  }).returning({ id: threadsTable.id });
  deletedThreadId = d!.id;
  const rows = await db.insert(messagesTable).values([
    { threadId, role: "user", content: "plaintext legacy row" },
    { threadId, role: "assistant", content: encryptField(USER, "encrypted row") },
    { threadId, role: "system", content: "system prompt — never embedded" },
    { threadId, role: "user", content: "   " },
    { threadId: deletedThreadId, role: "user", content: "soft-deleted — never embedded" },
  ]).returning({ id: messagesTable.id });
  messageIds = rows.map((r) => r.id);
});

afterAll(async () => {
  if (prevKey === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = prevKey;
  await db.execute(sql`DELETE FROM embeddings WHERE message_id IN (${sql.join(messageIds.map((i) => sql`${i}`), sql`, `)})`);
  await db.delete(messagesTable).where(inArray(messagesTable.id, messageIds));
  await db.delete(threadsTable).where(eq(threadsTable.userId, USER));
  await db.delete(profilesTable).where(eq(profilesTable.userId, USER));
});

beforeEach(async () => {
  vi.mocked(generateEmbeddingResult).mockReset();
  await db.execute(sql`DELETE FROM embeddings WHERE message_id IN (${sql.join(messageIds.map((i) => sql`${i}`), sql`, `)})`);
  await db.execute(sql`DELETE FROM embed_attempts WHERE message_id IN (${sql.join(messageIds.map((i) => sql`${i}`), sql`, `)})`);
  process.env.XAI_API_KEY = "server-fallback-test-key";
});

async function embeddedIds(): Promise<number[]> {
  const r = await db.execute<{ message_id: number }>(sql`
    SELECT message_id FROM embeddings WHERE message_id IN (${sql.join(messageIds.map((i) => sql`${i}`), sql`, `)}) ORDER BY message_id`);
  return r.rows.map((x) => Number(x.message_id));
}

describe("backfill:embeddings", () => {
  it("dry run makes no provider calls and no writes", async () => {
    expect(await runBackfill({ ...base, dryRun: true })).toBe(0);
    expect(generateEmbeddingResult).not.toHaveBeenCalled();
    expect(await embeddedIds()).toEqual([]);
  });

  it("embeds user/assistant rows (plaintext + encrypted) with the server key, skipping system/empty/deleted", async () => {
    vi.mocked(generateEmbeddingResult).mockResolvedValue({ vector, permanentFailure: false });
    expect(await runBackfill(base)).toBe(0);
    expect(await embeddedIds()).toEqual([messageIds[0], messageIds[1]]);
    const texts = vi.mocked(generateEmbeddingResult).mock.calls.map((c) => [c[0], c[1], c[2], c[3]]);
    expect(texts).toEqual([
      ["plaintext legacy row", "server-fallback-test-key", "xai", "passage"],
      ["encrypted row", "server-fallback-test-key", "xai", "passage"],
    ]);
  });

  it("is idempotent: a second run makes no calls", async () => {
    vi.mocked(generateEmbeddingResult).mockResolvedValue({ vector, permanentFailure: false });
    await runBackfill(base);
    vi.mocked(generateEmbeddingResult).mockClear();
    await runBackfill(base);
    expect(generateEmbeddingResult).not.toHaveBeenCalled();
  });

  it("resumes after --start-after and honours --limit", async () => {
    vi.mocked(generateEmbeddingResult).mockResolvedValue({ vector, permanentFailure: false });
    await runBackfill({ ...base, limit: 1 });
    expect(await embeddedIds()).toEqual([messageIds[0]]);
    await runBackfill({ ...base, startAfter: messageIds[0]! });
    expect(await embeddedIds()).toEqual([messageIds[0], messageIds[1]]);
  });

  it("aborts on a config error without marking any message", async () => {
    vi.mocked(generateEmbeddingResult).mockResolvedValue({ vector: null, permanentFailure: false, configError: true, status: 401 });
    expect(await runBackfill({ ...base, concurrency: 1 })).toBe(2);
    expect(generateEmbeddingResult).toHaveBeenCalledTimes(1);
    const marks = await db.execute(sql`SELECT 1 FROM embed_attempts WHERE message_id IN (${sql.join(messageIds.map((i) => sql`${i}`), sql`, `)})`);
    expect(marks.rows).toHaveLength(0);
  });

  it("records per-message permanent failures under the model key and skips them next run", async () => {
    vi.mocked(generateEmbeddingResult).mockResolvedValue({ vector: null, permanentFailure: true, status: 400, modelKey: "xai:v1:1536" });
    await runBackfill(base);
    const marks = await db.execute<{ model_key: string }>(sql`
      SELECT model_key FROM embed_attempts WHERE message_id IN (${sql.join(messageIds.map((i) => sql`${i}`), sql`, `)})`);
    expect(marks.rows.map((r) => r.model_key)).toEqual(["xai:v1:1536", "xai:v1:1536"]);
    vi.mocked(generateEmbeddingResult).mockClear();
    await runBackfill(base);
    expect(generateEmbeddingResult).not.toHaveBeenCalled();
  });

  it("skips everything when no key is available", async () => {
    delete process.env.XAI_API_KEY;
    delete process.env.EMBEDDING_API_KEY;
    await runBackfill(base);
    expect(generateEmbeddingResult).not.toHaveBeenCalled();
  });
});

describe("backfill:embeddings — thread title/summary embeddings", () => {
  it("embeds non-deleted threads once (content-hash idempotent)", async () => {
    await db.execute(sql`DELETE FROM thread_embeddings WHERE user_id = ${USER}`);
    vi.mocked(generateEmbeddingResult).mockResolvedValue({ vector, permanentFailure: false });
    await runBackfill({ ...base, threads: true });
    const rows = await db.execute<{ thread_id: number }>(sql`SELECT thread_id FROM thread_embeddings WHERE user_id = ${USER}`);
    expect(rows.rows.map((r) => Number(r.thread_id))).toEqual([threadId]);
    const threadCalls = vi.mocked(generateEmbeddingResult).mock.calls.filter((c) => c[0] === "backfill thread");
    expect(threadCalls).toHaveLength(1);
    vi.mocked(generateEmbeddingResult).mockClear();
    await runBackfill({ ...base, threads: true });
    expect(generateEmbeddingResult).not.toHaveBeenCalled();
  });
});

describe("rate limiter", () => {
  it("spaces acquisitions by 1000/rps ms", async () => {
    let t = 0;
    const sleeps: number[] = [];
    const acquire = createRateLimiter(4, () => t, async (ms) => { sleeps.push(ms); });
    await acquire(); await acquire(); await acquire();
    expect(sleeps).toEqual([250, 500]);
  });

  it("parses flags", () => {
    expect(parseArgs(["--", "--dry-run", "--rps", "2", "--batch-size", "50"])).toMatchObject({ dryRun: true, rps: 2, batchSize: 50 });
    expect(() => parseArgs(["--bogus"])).toThrow();
  });
});
