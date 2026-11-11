// Embeddings for thread titles + summaries, so a search can match what a whole
// conversation was about, not only individual messages.

import { createHash } from "crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { decryptField } from "./field-crypto";
import { generateEmbeddingResult } from "./embeddings";
import { getEmbeddingConfig, getEmbeddingDim, resolveEmbeddingKey, type ResolvedEmbeddingKey } from "./embedding-config";
import { logger } from "./logger";

/** Idempotent DDL; called from the vector-schema bootstrap. */
export async function ensureThreadEmbeddingSchema(): Promise<void> {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS thread_embeddings (
      thread_id    integer PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
      user_id      text    NOT NULL,
      profile_id   integer REFERENCES profiles(id) ON DELETE SET NULL,
      embedding    vector(${getEmbeddingDim()}) NOT NULL,
      content_hash text    NOT NULL,
      updated_at   timestamptz NOT NULL DEFAULT now()
    )
  `));
  await db.execute(sql`CREATE INDEX IF NOT EXISTS thread_embeddings_user_id_idx ON thread_embeddings (user_id)`);
}

/** Text that represents a thread for embedding. */
export function threadEmbeddingText(title: string, summary: string | null): string {
  const t = title.trim();
  const s = summary?.trim();
  return s ? `${t}\n\n${s}` : t;
}

/** Hash of the embedded text + model config: unchanged hash ⇒ skip re-embedding. */
export function threadContentHash(text: string, modelKey: string): string {
  return createHash("sha256").update(modelKey).update("\0").update(text).digest("hex");
}

type ThreadRow = {
  id: number;
  user_id: string;
  profile_id: number | null;
  title: string;
  summary: string | null;
  existing_hash: string | null;
  api_key: string | null;
  open_ai_api_key: string | null;
  settings_api_key: string | null;
  embedding_provider: string | null;
};

function threadRowsQuery(where: ReturnType<typeof sql>) {
  return sql<ThreadRow>`
    SELECT t.id, t.user_id, t.profile_id, t.title,
           (SELECT m.content FROM messages m
             WHERE m.thread_id = t.id AND m.is_summary = true
             ORDER BY m.created_at DESC LIMIT 1) AS summary,
           te.content_hash AS existing_hash,
           p.api_key, p.open_ai_api_key, s.api_key AS settings_api_key, p.embedding_provider
    FROM threads t
    LEFT JOIN thread_embeddings te ON te.thread_id = t.id
    LEFT JOIN profiles p ON p.id = t.profile_id
    LEFT JOIN settings s ON s.user_id = t.user_id
    WHERE t.deleted_at IS NULL ${where}
    ORDER BY t.id
  `;
}

async function embedRow(row: ThreadRow, key: ResolvedEmbeddingKey | null, dryRun: boolean): Promise<"ok" | "skipped" | "unchanged" | "failed" | "config_error"> {
  const k = key ?? resolveEmbeddingKey(
    row.user_id,
    { embeddingProvider: row.embedding_provider, apiKey: row.api_key, openAiApiKey: row.open_ai_api_key },
    { settingsApiKey: row.settings_api_key },
  );
  if (!k) return "skipped";
  let summary: string | null = null;
  try {
    summary = row.summary ? decryptField(row.user_id, row.summary) : null;
  } catch {
    summary = null;
  }
  const text = threadEmbeddingText(row.title, summary);
  if (!text) return "skipped";
  const hash = threadContentHash(text, getEmbeddingConfig(k.provider).modelKey);
  if (row.existing_hash === hash) return "unchanged";
  if (dryRun) return "ok";
  const r = await generateEmbeddingResult(text, k.apiKey, k.provider, "passage");
  if (r.configError) return "config_error";
  if (!r.vector) return "failed";
  await db.execute(sql`
    INSERT INTO thread_embeddings (thread_id, user_id, profile_id, embedding, content_hash, updated_at)
    VALUES (${row.id}, ${row.user_id}, ${row.profile_id}, ${`[${r.vector.join(",")}]`}::vector, ${hash}, now())
    ON CONFLICT (thread_id) DO UPDATE
      SET embedding = EXCLUDED.embedding, content_hash = EXCLUDED.content_hash,
          profile_id = EXCLUDED.profile_id, updated_at = now()
  `);
  return "ok";
}

/** Embed (or refresh) one thread's title+summary. Best-effort; never throws. */
export async function embedThread(userId: string, threadId: number, key?: ResolvedEmbeddingKey | null): Promise<boolean> {
  try {
    const rows = await db.execute<ThreadRow>(threadRowsQuery(sql`AND t.id = ${threadId} AND t.user_id = ${userId}`));
    const row = rows.rows[0];
    if (!row) return false;
    return (await embedRow(row, key ?? null, false)) === "ok";
  } catch (err) {
    logger.warn({ err, threadId }, "embedThread failed — thread-level search may miss it");
    return false;
  }
}

export function embedThreadAsync(userId: string, threadId: number, key?: ResolvedEmbeddingKey | null): void {
  void embedThread(userId, threadId, key);
}

/** Backfill thread embeddings; used by the backfill:embeddings script. */
export async function backfillThreadEmbeddings(opts: {
  dryRun: boolean;
  userId: string | null;
  limiter?: () => Promise<void>;
}): Promise<{ total: number; ok: number; unchanged: number; skipped: number; failed: number; aborted: boolean }> {
  const where = opts.userId ? sql`AND t.user_id = ${opts.userId}` : sql``;
  const rows = await db.execute<ThreadRow>(threadRowsQuery(where));
  const out = { total: rows.rows.length, ok: 0, unchanged: 0, skipped: 0, failed: 0, aborted: false };
  for (const row of rows.rows) {
    if (!opts.dryRun) await opts.limiter?.();
    const r = await embedRow(row, null, opts.dryRun);
    if (r === "config_error") { out.aborted = true; break; }
    out[r === "ok" ? "ok" : r === "unchanged" ? "unchanged" : r === "skipped" ? "skipped" : "failed"]++;
  }
  return out;
}

/** Semantic search over thread embeddings for one user (all profiles). */
export async function searchThreadEmbeddings(
  userId: string,
  queryVec: number[],
  limit: number,
  minScore = 0.3,
): Promise<Array<{ thread_id: number; score: number }>> {
  const vecLiteral = `[${queryVec.join(",")}]`;
  const r = await db.execute<{ thread_id: number; score: number }>(sql`
    SELECT te.thread_id, 1 - (te.embedding <=> ${vecLiteral}::vector) AS score
    FROM thread_embeddings te
    JOIN threads t ON t.id = te.thread_id
    WHERE te.user_id = ${userId} AND t.user_id = ${userId} AND t.deleted_at IS NULL
    ORDER BY te.embedding <=> ${vecLiteral}::vector
    LIMIT ${limit}
  `);
  return r.rows
    .map((x) => ({ thread_id: Number(x.thread_id), score: Number(x.score) }))
    .filter((x) => x.score > minScore);
}
