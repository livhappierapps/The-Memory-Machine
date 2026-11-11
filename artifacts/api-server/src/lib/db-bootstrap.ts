// Idempotent DB migration that runs at startup before accepting requests.
// Phase 1 (required columns) fails fast; Phase 2 (pgvector) is best-effort.

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { generateEmbeddingResult, storeEmbedding } from "./embeddings";
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

// Phase 2: pgvector — best-effort; log warning if extension is unavailable.
async function applyVectorSchema(): Promise<void> {
  // Enable extension — may fail if the DB role lacks CREATE privilege.
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);

  // Create embeddings table with UNIQUE on message_id (required for ON CONFLICT)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS embeddings (
      id          serial      PRIMARY KEY,
      message_id  integer     NOT NULL UNIQUE REFERENCES messages(id)  ON DELETE CASCADE,
      thread_id   integer     NOT NULL        REFERENCES threads(id)   ON DELETE CASCADE,
      profile_id  integer                     REFERENCES profiles(id)  ON DELETE SET NULL,
      embedding   vector(1536) NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now()
    )
  `);

  // Keep failures separate from real vectors so similarity search is unchanged.
  // A single permanent provider failure excludes a message from future sweeps.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS embed_attempts (
      message_id      integer PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      embed_failed_at timestamptz NOT NULL DEFAULT now(),
      http_status     integer NOT NULL CHECK (
        http_status >= 400 AND http_status < 500 AND http_status <> 429
      )
    )
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

  // Vector similarity index (IVFFlat, cosine)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS embeddings_embedding_idx
      ON embeddings USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
  `);

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
async function reembedOrphanedMessages(): Promise<void> {
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
    embedding_provider: string;
  };

  const skipped = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM embed_attempts a
    JOIN messages m ON m.id = a.message_id
    JOIN threads t ON t.id = m.thread_id
    LEFT JOIN embeddings e ON e.message_id = m.id
    WHERE e.id IS NULL AND t.deleted_at IS NULL
  `);
  const skippedCount = Number(skipped.rows[0]?.count ?? 0);
  if (skippedCount > 0) {
    logger.warn(
      { count: skippedCount },
      "Startup re-embed sweep: skipping messages with recorded permanent embedding failures",
    );
  }

  const rows = await db.execute<OrphanRow>(sql`
    SELECT
      m.id                                   AS message_id,
      m.thread_id                            AS thread_id,
      t.profile_id                           AS profile_id,
      t.user_id                              AS user_id,
      m.content                              AS encrypted_content,
      p.api_key                              AS api_key,
      p.open_ai_api_key                      AS open_ai_api_key,
      COALESCE(p.embedding_provider, 'xai')  AS embedding_provider
    FROM messages m
    JOIN threads t ON t.id = m.thread_id
    LEFT JOIN profiles p ON p.id = t.profile_id
    LEFT JOIN embeddings e ON e.message_id = m.id
    LEFT JOIN embed_attempts a ON a.message_id = m.id
    WHERE e.id IS NULL
      AND a.message_id IS NULL
      AND t.deleted_at IS NULL
      AND (p.api_key IS NOT NULL OR p.open_ai_api_key IS NOT NULL)
    LIMIT 200
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
      // Resolve the correct (decrypted) embedding key based on the provider.
      // API keys are stored as AES-256-GCM ciphertext (enc:v1:…); decryptField
      // returns plaintext for encrypted values and the raw value for legacy plaintext.
      const provider = row.embedding_provider;
      const rawKey =
        provider === "openai" && row.open_ai_api_key
          ? row.open_ai_api_key
          : row.api_key;
      if (!rawKey) {
        failed++;
        logger.warn({ messageId: row.message_id }, "Startup re-embed sweep: no usable API key for message — skipping");
        continue;
      }
      const plainKey = decryptField(row.user_id, rawKey);

      // Decrypt the stored content using the owning user's ID as the key salt
      const plaintext = decryptField(row.user_id, row.encrypted_content);
      const { vector: vec, permanentFailure, status } = await generateEmbeddingResult(plaintext, plainKey, provider);
      if (vec) {
        const stored = await storeEmbedding(row.message_id, row.thread_id, row.profile_id, vec);
        if (stored) {
          succeeded++;
        } else {
          failed++;
          logger.warn({ messageId: row.message_id }, "Startup re-embed sweep: DB write failed for message");
        }
      } else {
        failed++;
        if (permanentFailure && status !== undefined) {
          await db.execute(sql`
            INSERT INTO embed_attempts (message_id, http_status)
            VALUES (${row.message_id}, ${status})
            ON CONFLICT (message_id) DO UPDATE
              SET embed_failed_at = now(), http_status = EXCLUDED.http_status
          `);
          logger.warn(
            { messageId: row.message_id, status },
            "Startup re-embed sweep: permanent embedding failure recorded — excluded from future sweeps",
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
