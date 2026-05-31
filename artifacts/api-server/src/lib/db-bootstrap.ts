// Idempotent DB migration that runs at startup before accepting requests.
// Phase 1 (required columns) fails fast; Phase 2 (pgvector) is best-effort.

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

async function applyRequiredSchema(): Promise<void> {
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

let pgvectorAvailableFlag = false;

/** Returns true if pgvector was successfully bootstrapped at startup. */
export function isPgvectorAvailable(): boolean {
  return pgvectorAvailableFlag;
}

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
}
