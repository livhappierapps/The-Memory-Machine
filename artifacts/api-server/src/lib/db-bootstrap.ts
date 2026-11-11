// Idempotent DB migration that runs at startup before accepting requests.
// Phase 1 (required columns) fails fast; Phase 2 (pgvector) is best-effort.

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { generateEmbeddingResult, storeEmbedding } from "./embeddings";
import {
  getEmbeddingConfig,
  getEmbeddingDim,
  resolveEmbeddingKey,
  serverEmbeddingKey,
} from "./embedding-config";
import { decryptField } from "./field-crypto";
import { ensureOAuthCodeSchema } from "./oauth-code-store";

async function applyRequiredSchema(): Promise<void> {
  // Shared, single-use OAuth codes must survive autoscaling and restarts.
  await ensureOAuthCodeSchema();
  // Ensure audit_events table exists with a DB-level check constraint on action
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS audit_events (
      id         SERIAL PRIMARY KEY,
      user_id    TEXT        NOT NULL,
      action     TEXT        NOT NULL,
      metadata   JSONB,
      ip         TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT audit_events_action_check CHECK (action IN (
        'sign_in','keyphrase_set','keyphrase_verified',
        'device_registered','device_revoked',
        'snapshot_created','snapshot_restored','snapshot_deleted',
        'deletion_requested'
      ))
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS audit_events_user_id_idx    ON audit_events (user_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS audit_events_created_at_idx ON audit_events (created_at)
  `);

  // Ensure smart-memory and multi-provider columns exist on profiles
  await db.execute(sql`
    ALTER TABLE profiles
      ADD COLUMN IF NOT EXISTS embedding_provider    text    NOT NULL DEFAULT 'xai',
      ADD COLUMN IF NOT EXISTS open_ai_api_key       text,
      ADD COLUMN IF NOT EXISTS smart_retrieval       boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS top_n_memories        integer NOT NULL DEFAULT 10,
      ADD COLUMN IF NOT EXISTS always_include_last_n integer NOT NULL DEFAULT 3,
      ADD COLUMN IF NOT EXISTS memory_date_from      text,
      ADD COLUMN IF NOT EXISTS memory_date_to        text,
      ADD COLUMN IF NOT EXISTS chat_provider         text    NOT NULL DEFAULT 'xai',
      ADD COLUMN IF NOT EXISTS anthropic_api_key     text,
      ADD COLUMN IF NOT EXISTS google_api_key        text
  `);

  // Ensure memory_weight column exists on threads
  await db.execute(sql`
    ALTER TABLE threads
      ADD COLUMN IF NOT EXISTS memory_weight integer NOT NULL DEFAULT 0
  `);

  // Ensure source column exists on threads (tracks MCP-created notes vs regular chat)
  await db.execute(sql`
    ALTER TABLE threads
      ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'chat'
  `);
}

/**
 * Read the declared dimension of embeddings.embedding (vector(N) → N), or null
 * if the table/column does not exist.
 */
async function currentVectorDim(table = "embeddings"): Promise<number | null> {
  const r = await db.execute<{ t: string | null }>(sql`
    SELECT format_type(a.atttypid, a.atttypmod) AS t
    FROM pg_attribute a
    WHERE a.attrelid = to_regclass(${table})
      AND a.attname = 'embedding' AND NOT a.attisdropped
  `);
  const t = r.rows[0]?.t;
  const m = t ? /vector\((\d+)\)/.exec(t) : null;
  return m ? Number(m[1]) : null;
}

/**
 * Migration: if the configured EMBEDDING_DIM differs from the column's declared
 * dimension, ALTER the column — but only when the table is empty (vectors of a
 * different size cannot be converted). Non-empty mismatches are logged and left
 * alone; embedding writes will then fail validation until EMBEDDING_DIM is fixed.
 * Exported for the backfill script / tests.
 */
export async function migrateVectorDimension(table = "embeddings", indexName = "embeddings_embedding_idx"): Promise<
  "unchanged" | "altered" | "blocked_nonempty" | "missing"
> {
  const want = getEmbeddingDim();
  const have = await currentVectorDim(table);
  if (have === null) return "missing";
  if (have === want) return "unchanged";
  const cnt = await db.execute<{ n: string }>(sql`SELECT COUNT(*)::text AS n FROM ${sql.identifier(table)}`);
  if (Number(cnt.rows[0]?.n ?? 0) > 0) {
    logger.error(
      { table, have, want },
      "Embedding dimension mismatch on a non-empty table — NOT altering. Set EMBEDDING_DIM back or clear the table first.",
    );
    return "blocked_nonempty";
  }
  await db.execute(sql`DROP INDEX IF EXISTS ${sql.identifier(indexName)}`);
  await db.execute(
    sql.raw(`ALTER TABLE "${table}" ALTER COLUMN embedding TYPE vector(${want})`),
  );
  logger.warn({ table, from: have, to: want }, "Migrated empty embeddings table to new vector dimension");
  return "altered";
}

/**
 * pgvector ivfflat/hnsw indexes support at most 2000 dimensions for `vector`.
 * Larger embeddings are still stored and searched (sequential scan).
 */
function canIndex(dim: number): boolean {
  return dim <= 2000;
}

// Phase 2: pgvector — best-effort; log warning if extension is unavailable.
async function applyVectorSchema(): Promise<void> {
  const dim = getEmbeddingDim();
  // Enable extension — may fail if the DB role lacks CREATE privilege.
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);

  // Create embeddings table with UNIQUE on message_id (required for ON CONFLICT).
  // The vector dimension comes from EMBEDDING_DIM (default 1536).
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS embeddings (
      id          serial      PRIMARY KEY,
      message_id  integer     NOT NULL UNIQUE REFERENCES messages(id)  ON DELETE CASCADE,
      thread_id   integer     NOT NULL        REFERENCES threads(id)   ON DELETE CASCADE,
      profile_id  integer                     REFERENCES profiles(id)  ON DELETE SET NULL,
      embedding   vector(${dim}) NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now()
    )
  `));
  await migrateVectorDimension("embeddings", "embeddings_embedding_idx");

  // Keep failures separate from real vectors so similarity search is unchanged.
  // A permanent provider failure excludes a message from future sweeps — but only
  // for the same embedding config (model_key = provider:model:dim). Changing the
  // model/provider/dimension makes those messages eligible again.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS embed_attempts (
      message_id      integer NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      model_key       text    NOT NULL DEFAULT 'legacy',
      embed_failed_at timestamptz NOT NULL DEFAULT now(),
      http_status     integer NOT NULL CHECK (
        http_status >= 400 AND http_status < 500 AND http_status <> 429
      ),
      PRIMARY KEY (message_id, model_key)
    )
  `);
  // Migrate the legacy single-key table (PK on message_id only).
  await db.execute(sql`
    ALTER TABLE embed_attempts ADD COLUMN IF NOT EXISTS model_key text NOT NULL DEFAULT 'legacy'
  `);
  await db.execute(sql`
    DO $$
    DECLARE pk_cols int;
    BEGIN
      SELECT array_length(c.conkey, 1) INTO pk_cols
      FROM pg_constraint c
      WHERE c.conrelid = 'embed_attempts'::regclass AND c.contype = 'p';
      IF pk_cols IS NULL OR pk_cols = 1 THEN
        ALTER TABLE embed_attempts DROP CONSTRAINT IF EXISTS embed_attempts_pkey;
        ALTER TABLE embed_attempts ADD CONSTRAINT embed_attempts_pkey PRIMARY KEY (message_id, model_key);
      END IF;
    END
    $$
  `);

  // Add UNIQUE constraint if the table already existed without it
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'embeddings_message_id_key'
          AND conrelid = 'embeddings'::regclass
      ) THEN
        ALTER TABLE embeddings ADD CONSTRAINT embeddings_message_id_key UNIQUE (message_id);
      END IF;
    END
    $$
  `);

  // Vector similarity index (IVFFlat, cosine). Note: an ivfflat index built on
  // an empty table has poor recall — the backfill script REINDEXes it at the end.
  if (canIndex(dim)) {
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS embeddings_embedding_idx
        ON embeddings USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
    `);
  } else {
    logger.warn({ dim }, "Embedding dimension > 2000 — skipping ivfflat index (sequential scan)");
  }

  // Lookup indexes
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS embeddings_thread_id_idx  ON embeddings (thread_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS embeddings_profile_id_idx ON embeddings (profile_id)
  `);
}

/** Ensure the pgvector schema exists without running the startup re-embedding sweep. */
export async function ensureVectorSchema(): Promise<void> {
  await applyVectorSchema();
}

let pgvectorAvailableFlag = false;

/** Returns true if pgvector was successfully bootstrapped at startup. */
export function isPgvectorAvailable(): boolean {
  return pgvectorAvailableFlag;
}

/**
 * Background sweep: find any messages that were saved (e.g. via MCP save_memory)
 * but whose embeddings were never written — this can happen if the server restarted
 * before a fire-and-forget embedding job completed.  Re-embeds them now using the
 * profile's stored API key so semantic search is not silently incomplete.
 *
 * Runs fire-and-forget after boot so it never delays the server coming up.
 * Processes at most 200 orphaned messages per restart to cap cold-start API usage.
 * Permanent provider failures are persisted and excluded on subsequent restarts.
 */
async function reembedOrphanedMessages(limit = 200): Promise<void> {
  type OrphanRow = {
    message_id: number;
    thread_id: number;
    profile_id: number | null;
    user_id: string;
    encrypted_content: string;
    /** Raw (possibly encrypted) xAI API key — must be decrypted before use. */
    api_key: string | null;
    /** Raw (possibly encrypted) OpenAI API key — must be decrypted before use. */
    open_ai_api_key: string | null;
    /** Raw (possibly encrypted) legacy settings.api_key fallback. */
    settings_api_key: string | null;
    embedding_provider: string;
  };

  const xaiKey = getEmbeddingConfig("xai").modelKey;
  const openaiKey = getEmbeddingConfig("openai").modelKey;
  const hasServerKey = !!serverEmbeddingKey("xai") || !!serverEmbeddingKey("openai");

  const skipped = await db.execute<{ count: string }>(sql`
    SELECT COUNT(DISTINCT a.message_id)::text AS count
    FROM embed_attempts a
    JOIN messages m ON m.id = a.message_id
    JOIN threads t ON t.id = m.thread_id
    LEFT JOIN embeddings e ON e.message_id = m.id
    WHERE e.id IS NULL AND t.deleted_at IS NULL
      AND a.model_key IN (${xaiKey}, ${openaiKey})
  `);
  const skippedCount = Number(skipped.rows[0]?.count ?? 0);
  if (skippedCount > 0) {
    logger.warn(
      { count: skippedCount },
      "Startup re-embed sweep: skipping messages with recorded permanent embedding failures for the current model",
    );
  }

  // Note: the provider actually used may differ from p.embedding_provider
  // (openai without a key falls back to xai); markers for either current
  // model key exclude the message, which is the conservative choice.
  const rows = await db.execute<OrphanRow>(sql`
    SELECT
      m.id                                   AS message_id,
      m.thread_id                            AS thread_id,
      t.profile_id                           AS profile_id,
      t.user_id                              AS user_id,
      m.content                              AS encrypted_content,
      p.api_key                              AS api_key,
      p.open_ai_api_key                      AS open_ai_api_key,
      s.api_key                              AS settings_api_key,
      COALESCE(p.embedding_provider, 'xai')  AS embedding_provider
    FROM messages m
    JOIN threads t ON t.id = m.thread_id
    LEFT JOIN profiles p ON p.id = t.profile_id
    LEFT JOIN settings s ON s.user_id = t.user_id
    LEFT JOIN embeddings e ON e.message_id = m.id
    WHERE e.id IS NULL
      AND t.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM embed_attempts a
        WHERE a.message_id = m.id AND a.model_key IN (${xaiKey}, ${openaiKey})
      )
      AND (
        ${hasServerKey}
        OR p.api_key IS NOT NULL OR p.open_ai_api_key IS NOT NULL OR s.api_key IS NOT NULL
      )
    ORDER BY m.id
    LIMIT ${limit}
  `);

  if (rows.rows.length === 0) {
    logger.info("Startup re-embed sweep: no orphaned messages found");
    return;
  }

  logger.info(
    { count: rows.rows.length },
    "Startup re-embed sweep: found orphaned messages without embeddings — re-embedding now",
  );

  let succeeded = 0;
  let failed = 0;

  for (const row of rows.rows) {
    try {
      const resolved = resolveEmbeddingKey(
        row.user_id,
        { embeddingProvider: row.embedding_provider, apiKey: row.api_key, openAiApiKey: row.open_ai_api_key },
        { settingsApiKey: row.settings_api_key },
      );
      if (!resolved) {
        failed++;
        logger.warn({ messageId: row.message_id }, "Startup re-embed sweep: no usable API key for message — skipping");
        continue;
      }

      // Decrypt the stored content using the owning user's ID as the key salt
      const plaintext = decryptField(row.user_id, row.encrypted_content);
      const { vector: vec, permanentFailure, configError, status, modelKey } =
        await generateEmbeddingResult(plaintext, resolved.apiKey, resolved.provider, "passage");
      if (vec) {
        const stored = await storeEmbedding(row.message_id, row.thread_id, row.profile_id, vec);
        if (stored) {
          succeeded++;
        } else {
          failed++;
          logger.warn({ messageId: row.message_id }, "Startup re-embed sweep: DB write failed for message");
        }
      } else if (configError) {
        // Key/model/dimension problem — affects every message. Stop the sweep
        // instead of burning requests, and never mark messages for it.
        failed++;
        logger.error(
          { status, provider: resolved.provider, source: resolved.source },
          "Startup re-embed sweep: embedding configuration error — aborting sweep (no messages marked)",
        );
        break;
      } else {
        failed++;
        if (permanentFailure && status !== undefined) {
          await db.execute(sql`
            INSERT INTO embed_attempts (message_id, model_key, http_status)
            VALUES (${row.message_id}, ${modelKey ?? getEmbeddingConfig(resolved.provider).modelKey}, ${status})
            ON CONFLICT (message_id, model_key) DO UPDATE
              SET embed_failed_at = now(), http_status = EXCLUDED.http_status
          `);
          logger.warn(
            { messageId: row.message_id, status },
            "Startup re-embed sweep: permanent embedding failure recorded — excluded from future sweeps for this model",
          );
        } else {
          logger.warn(
            { messageId: row.message_id, status },
            "Startup re-embed sweep: embedding unavailable — eligible for a future sweep",
          );
        }
      }
    } catch (err) {
      failed++;
      logger.warn({ err, messageId: row.message_id }, "Startup re-embed sweep: failed for message");
    }
  }

  logger.info(
    { succeeded, failed, total: rows.rows.length },
    "Startup re-embed sweep complete",
  );
}

/** Exported for testing — allows the test suite to invoke the sweep directly. */
export { reembedOrphanedMessages };

export async function runDbBootstrap(): Promise<void> {
  // Phase 1: required columns — fail fast so the server doesn't start with
  // a broken schema that will cause runtime query errors.
  await applyRequiredSchema();
  logger.info("DB bootstrap phase 1 (required schema) completed");

  // Phase 2: pgvector — best-effort; log and continue if unavailable.
  try {
    await applyVectorSchema();
    pgvectorAvailableFlag = true;
    logger.info("DB bootstrap phase 2 (vector schema) completed");
  } catch (err) {
    logger.warn(
      { err },
      "DB bootstrap phase 2 (pgvector) failed — smart semantic retrieval will be unavailable",
    );
  }

  // Phase 3: re-embed any orphaned messages in the background.
  // Fire-and-forget — never blocks the server from accepting requests.
  if (pgvectorAvailableFlag) {
    reembedOrphanedMessages().catch((err) =>
      logger.warn({ err }, "Startup re-embed sweep failed unexpectedly"),
    );
  }
}
