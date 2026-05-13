/**
 * db-bootstrap.ts — one-shot idempotent DB migration that runs at startup.
 *
 * Enables pgvector and creates the `embeddings` table + indexes if they do
 * not already exist. Safe to run on every boot (all statements use IF NOT EXISTS).
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

export async function runDbBootstrap(): Promise<void> {
  try {
    // 1. Enable pgvector extension (requires superuser or pg_extension_owner)
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);

    // 2. Create the embeddings table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS embeddings (
        id          serial      PRIMARY KEY,
        message_id  integer     NOT NULL REFERENCES messages(id)  ON DELETE CASCADE,
        thread_id   integer     NOT NULL REFERENCES threads(id)   ON DELETE CASCADE,
        profile_id  integer              REFERENCES profiles(id)  ON DELETE SET NULL,
        embedding   vector(1536) NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    // 3. Vector similarity index (IVFFlat — good for cosine search)
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS embeddings_embedding_idx
        ON embeddings USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
    `);

    // 4. Lookup indexes
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS embeddings_thread_id_idx ON embeddings (thread_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS embeddings_profile_id_idx ON embeddings (profile_id)
    `);

    // 5. Ensure smart-memory columns exist on profiles (added in a previous migration)
    await db.execute(sql`
      ALTER TABLE profiles
        ADD COLUMN IF NOT EXISTS smart_retrieval      boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS top_n_memories       integer NOT NULL DEFAULT 10,
        ADD COLUMN IF NOT EXISTS always_include_last_n integer NOT NULL DEFAULT 3,
        ADD COLUMN IF NOT EXISTS memory_date_from     text,
        ADD COLUMN IF NOT EXISTS memory_date_to       text
    `);

    // 6. Ensure memory_weight column exists on threads
    await db.execute(sql`
      ALTER TABLE threads
        ADD COLUMN IF NOT EXISTS memory_weight integer NOT NULL DEFAULT 0
    `);

    logger.info("DB bootstrap completed successfully");
  } catch (err) {
    // Log but don't crash — the server can still function without embeddings
    logger.warn({ err }, "DB bootstrap failed (some features may be unavailable)");
  }
}
