/**
 * embeddings table — stores pgvector embeddings for messages.
 *
 * Note: pgvector's `vector(1536)` column type is not natively supported by
 * drizzle-kit migrations. The table is kept in this schema file for
 * documentation and type reference; the actual CREATE TABLE was applied once
 * via db.execute() in a one-shot migration script. All reads/writes use
 * db.execute(sql`...`) directly so drizzle-kit never needs to diff it.
 *
 * Schema (applied via raw SQL):
 *   CREATE TABLE embeddings (
 *     id          serial PRIMARY KEY,
 *     message_id  integer NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 *     thread_id   integer NOT NULL REFERENCES threads(id)  ON DELETE CASCADE,
 *     profile_id  integer REFERENCES profiles(id) ON DELETE SET NULL,
 *     embedding   vector(1536) NOT NULL,
 *     created_at  timestamptz  NOT NULL DEFAULT now()
 *   );
 *   CREATE INDEX ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
 *   CREATE INDEX ON embeddings (thread_id);
 *   CREATE INDEX ON embeddings (profile_id);
 */

// Re-exported so the schema index stays consistent; no Drizzle table object
// because drizzle-kit cannot handle vector columns without a plugin.
export const EMBEDDINGS_TABLE_NAME = "embeddings" as const;
