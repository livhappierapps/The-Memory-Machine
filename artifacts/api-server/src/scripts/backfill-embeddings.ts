/**
 * Backfill embeddings for existing messages.
 *
 *   pnpm --filter @workspace/api-server run backfill:embeddings -- --dry-run
 *   pnpm --filter @workspace/api-server run backfill:embeddings -- --rps 5 --batch-size 200
 *
 * Properties:
 *  - Idempotent: only selects messages with no embeddings row; writes use
 *    ON CONFLICT (message_id). Re-running after completion is a no-op.
 *  - Resumable: keyset pagination by message id. Interrupt at any time and
 *    re-run (optionally with --start-after <id> from the last progress line).
 *  - Rate limited: --rps caps request starts per second; --concurrency caps
 *    in-flight requests. 429s are retried with backoff by the embeddings lib.
 *  - Safe failure handling: per-message permanent 4xx are recorded in
 *    embed_attempts under the current model_key; auth/model/dimension errors
 *    abort the run WITHOUT marking any message.
 *  - --dry-run makes no API calls and no writes; it reports counts, key
 *    availability and a token/cost estimate.
 *  - Never logs message content or API keys.
 *
 * Flags:
 *   --dry-run              report only
 *   --batch-size <n>       rows fetched per DB page (default 100)
 *   --rps <n>              max embedding requests per second (default 5)
 *   --concurrency <n>      max in-flight requests (default 4)
 *   --limit <n>            stop after n messages (default: all)
 *   --start-after <id>     resume after this message id (default 0)
 *   --user <userId>        only this user's messages
 *   --no-threads           skip thread title/summary embeddings
 *   --no-reindex           skip REINDEX of the ivfflat index at the end
 *   --price-per-mtok <usd> price used for the dry-run estimate (default 0.10)
 */

import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { decryptField } from "../lib/field-crypto";
import { generateEmbeddingResult, storeEmbedding } from "../lib/embeddings";
import { getEmbeddingConfig, resolveEmbeddingKey, type ResolvedEmbeddingKey } from "../lib/embedding-config";
import { ensureVectorSchema } from "../lib/db-bootstrap";
import { backfillThreadEmbeddings } from "../lib/thread-embeddings";

export interface BackfillOptions {
  dryRun: boolean;
  batchSize: number;
  rps: number;
  concurrency: number;
  limit: number | null;
  startAfter: number;
  userId: string | null;
  reindex: boolean;
  threads: boolean;
  pricePerMTok: number;
}

export function parseArgs(argv: string[]): BackfillOptions {
  const o: BackfillOptions = {
    dryRun: false, batchSize: 100, rps: 5, concurrency: 4, limit: null, startAfter: 0,
    userId: null, reindex: true, threads: true, pricePerMTok: 0.1,
  };
  const num = (v: string | undefined, name: string) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid value for ${name}: ${v}`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--": break;
      case "--dry-run": o.dryRun = true; break;
      case "--batch-size": o.batchSize = Math.max(1, Math.floor(num(argv[++i], a))); break;
      case "--rps": o.rps = Math.max(0.1, num(argv[++i], a)); break;
      case "--concurrency": o.concurrency = Math.max(1, Math.floor(num(argv[++i], a))); break;
      case "--limit": o.limit = Math.floor(num(argv[++i], a)); break;
      case "--start-after": o.startAfter = Math.floor(num(argv[++i], a)); break;
      case "--user": o.userId = argv[++i] ?? null; break;
      case "--no-reindex": o.reindex = false; break;
      case "--no-threads": o.threads = false; break;
      case "--price-per-mtok": o.pricePerMTok = num(argv[++i], a); break;
      default: throw new Error(`Unknown flag: ${a}`);
    }
  }
  return o;
}

/** Simple spacing rate limiter: at most `rps` acquisitions per second. */
export function createRateLimiter(rps: number, now = () => Date.now(), sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))) {
  const gap = 1000 / rps;
  let next = 0;
  return async () => {
    const t = now();
    const at = Math.max(t, next);
    next = at + gap;
    if (at > t) await sleep(at - t);
  };
}

type Row = {
  message_id: number;
  thread_id: number;
  profile_id: number | null;
  user_id: string;
  content: string;
  api_key: string | null;
  open_ai_api_key: string | null;
  settings_api_key: string | null;
  embedding_provider: string | null;
};

function pageQuery(afterId: number, batch: number, userId: string | null, modelKeys: string[], attemptsReady: boolean) {
  const userSql = userId ? sql`AND t.user_id = ${userId}` : sql``;
  const attemptsSql = attemptsReady
    ? sql`AND NOT EXISTS (
        SELECT 1 FROM embed_attempts a
        WHERE a.message_id = m.id AND a.model_key IN (${sql.join(modelKeys.map((k) => sql`${k}`), sql`, `)})
      )`
    : sql``;
  return sql`
    SELECT m.id AS message_id, m.thread_id, t.profile_id, t.user_id, m.content,
           p.api_key, p.open_ai_api_key, s.api_key AS settings_api_key, p.embedding_provider
    FROM messages m
    JOIN threads t ON t.id = m.thread_id
    LEFT JOIN profiles p ON p.id = t.profile_id
    LEFT JOIN settings s ON s.user_id = t.user_id
    LEFT JOIN embeddings e ON e.message_id = m.id
    WHERE m.id > ${afterId}
      AND e.id IS NULL
      AND t.deleted_at IS NULL
      AND m.role IN ('user', 'assistant')
      ${attemptsSql}
      ${userSql}
    ORDER BY m.id
    LIMIT ${batch}
  `;
}

function log(event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
}

/** True when embed_attempts exists with the model_key column (new schema). */
async function attemptsSchemaReady(): Promise<boolean> {
  const r = await db.execute<{ ok: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'embed_attempts' AND column_name = 'model_key'
    ) AS ok`);
  return !!r.rows[0]?.ok;
}

async function threadTableExists(): Promise<boolean> {
  const r = await db.execute<{ ok: boolean }>(sql`SELECT to_regclass('thread_embeddings') IS NOT NULL AS ok`);
  return !!r.rows[0]?.ok;
}

export async function runBackfill(opts: BackfillOptions): Promise<number> {
  // Real runs make sure the schema/migrations are applied (idempotent DDL).
  // Dry runs are strictly read-only: no DDL, no writes, no API calls.
  if (!opts.dryRun) await ensureVectorSchema();
  const attemptsReady = await attemptsSchemaReady();
  if (!attemptsReady) {
    if (!opts.dryRun) throw new Error("embed_attempts.model_key missing after schema bootstrap");
    log("note", { message: "embed_attempts not migrated yet (deploy first); dry run ignores failure markers" });
  }
  const modelKeys = [getEmbeddingConfig("xai").modelKey, getEmbeddingConfig("openai").modelKey];
  log("start", {
    dryRun: opts.dryRun,
    xai: getEmbeddingConfig("xai").modelKey,
    openai: getEmbeddingConfig("openai").modelKey,
    rps: opts.rps, concurrency: opts.concurrency, batchSize: opts.batchSize, startAfter: opts.startAfter,
  });

  const limiter = createRateLimiter(opts.rps);
  let afterId = opts.startAfter;
  let seen = 0, ok = 0, failed = 0, marked = 0, skippedNoKey = 0, skippedEmpty = 0;
  let chars = 0;
  const bySource: Record<string, number> = {};
  const started = Date.now();
  let aborted = false;

  let reachedLimit = false;
  while (!reachedLimit) {
    const page = await db.execute<Row>(pageQuery(afterId, opts.batchSize, opts.userId, modelKeys, attemptsReady));
    if (page.rows.length === 0) break;

    const work: Array<{ row: Row; text: string; key: ResolvedEmbeddingKey }> = [];
    for (const row of page.rows) {
      if (opts.limit !== null && seen >= opts.limit) { reachedLimit = true; break; }
      afterId = row.message_id;
      seen++;
      let text: string;
      try {
        text = decryptField(row.user_id, row.content).trim();
      } catch {
        failed++;
        continue;
      }
      if (!text) { skippedEmpty++; continue; }
      const key = resolveEmbeddingKey(
        row.user_id,
        { embeddingProvider: row.embedding_provider, apiKey: row.api_key, openAiApiKey: row.open_ai_api_key },
        { settingsApiKey: row.settings_api_key },
      );
      if (!key) { skippedNoKey++; continue; }
      bySource[`${key.provider}/${key.source}`] = (bySource[`${key.provider}/${key.source}`] ?? 0) + 1;
      chars += Math.min(text.length, 8_000);
      work.push({ row, text, key });
    }

    if (!opts.dryRun) {
      // Bounded concurrency over this page.
      let idx = 0;
      const worker = async () => {
        while (!aborted && idx < work.length) {
          const { row, text, key } = work[idx++]!;
          await limiter();
          const r = await generateEmbeddingResult(text, key.apiKey, key.provider, "passage");
          if (r.vector) {
            if (await storeEmbedding(row.message_id, row.thread_id, row.profile_id, r.vector)) ok++;
            else failed++;
          } else if (r.configError) {
            aborted = true;
            log("abort_config_error", { status: r.status, provider: key.provider, source: key.source, messageId: row.message_id });
          } else {
            failed++;
            if (r.permanentFailure && r.status !== undefined) {
              await db.execute(sql`
                INSERT INTO embed_attempts (message_id, model_key, http_status)
                VALUES (${row.message_id}, ${r.modelKey ?? getEmbeddingConfig(key.provider).modelKey}, ${r.status})
                ON CONFLICT (message_id, model_key) DO UPDATE
                  SET embed_failed_at = now(), http_status = EXCLUDED.http_status
              `);
              marked++;
            }
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(opts.concurrency, work.length) }, worker));
      if (aborted) break;
    }

    const elapsed = (Date.now() - started) / 1000;
    log("progress", {
      lastMessageId: afterId, seen, ok, failed, marked, skippedNoKey, skippedEmpty,
      perSec: Number((ok / Math.max(elapsed, 1)).toFixed(2)),
    });
  }

  const estTokens = Math.ceil(chars / 4);
  if (opts.dryRun) {
    log("dry_run_summary", {
      eligibleMessages: seen,
      wouldEmbed: seen - skippedNoKey - skippedEmpty - failed,
      skippedNoKey, skippedEmpty, undecryptable: failed,
      keySources: bySource,
      estTokens,
      estCostUsd: Number(((estTokens / 1e6) * opts.pricePerMTok).toFixed(4)),
      pricePerMTokUsd: opts.pricePerMTok,
      estMinutesAtRps: Number(((seen - skippedNoKey - skippedEmpty) / opts.rps / 60).toFixed(1)),
    });
  }

  if (!aborted && opts.threads) {
    if (opts.dryRun && !(await threadTableExists())) {
      log("threads", { note: "thread_embeddings not created yet (deploy first)" });
    } else {
      const t = await backfillThreadEmbeddings({ dryRun: opts.dryRun, userId: opts.userId, limiter });
      log("threads", t);
      if (t.aborted) aborted = true;
    }
  }

  if (!opts.dryRun && !aborted && opts.reindex && ok > 0) {
    // ivfflat centroids are computed at index build time; an index built on an
    // empty table gives poor recall, so rebuild once real vectors exist.
    try {
      await db.execute(sql`REINDEX INDEX embeddings_embedding_idx`);
      await db.execute(sql`ANALYZE embeddings`);
      log("reindexed");
    } catch (err) {
      log("reindex_failed", { error: (err as Error).message });
    }
  }

  log("done", { seen, ok, failed, marked, skippedNoKey, skippedEmpty, aborted, lastMessageId: afterId });
  return aborted ? 2 : 0;
}

const isMain = process.argv[1] && /backfill-embeddings\.(ts|js|mjs)$/.test(process.argv[1]);
if (isMain) {
  let code = 1;
  try {
    code = await runBackfill(parseArgs(process.argv.slice(2)));
  } catch (err) {
    console.error("backfill failed:", (err as Error).message);
  } finally {
    await pool.end().catch(() => {});
  }
  process.exit(code);
}
