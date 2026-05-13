/**
 * embeddings.ts — Embedding generation and storage service.
 *
 * Uses the xAI API (OpenAI-compatible) to generate text-embedding-3-small
 * vectors. Falls back gracefully if the API call fails — missing embeddings
 * simply mean smart retrieval won't have vectors for that message.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIM = 1536;
const XAI_EMBEDDINGS_URL = "https://api.x.ai/v1/embeddings";

/** Generate an embedding vector for the given text. Returns null on failure. */
export async function generateEmbedding(
  text: string,
  apiKey: string,
): Promise<number[] | null> {
  // Truncate to ~8 000 chars to stay under token limits
  const input = text.slice(0, 8000).trim();
  if (!input) return null;

  try {
    const response = await fetch(XAI_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.warn(
        { status: response.status, body: body.slice(0, 200) },
        "Embedding API returned error — smart retrieval skipped for this message",
      );
      return null;
    }

    const data = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const vec = data.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) {
      logger.warn({ vecLen: vec?.length }, "Unexpected embedding dimension — skipping");
      return null;
    }

    return vec;
  } catch (err) {
    logger.warn({ err }, "Failed to call embeddings API — smart retrieval skipped");
    return null;
  }
}

/**
 * Store an embedding for a message in the embeddings table.
 * Fire-and-forget — errors are logged but not re-thrown.
 */
export async function storeEmbedding(
  messageId: number,
  threadId: number,
  profileId: number | null,
  vector: number[],
): Promise<void> {
  try {
    const vecLiteral = `[${vector.join(",")}]`;
    await db.execute(
      sql`
        INSERT INTO embeddings (message_id, thread_id, profile_id, embedding)
        VALUES (${messageId}, ${threadId}, ${profileId}, ${vecLiteral}::vector)
        ON CONFLICT (message_id) DO UPDATE SET embedding = EXCLUDED.embedding
      `,
    );
  } catch (err) {
    logger.warn({ err, messageId }, "Failed to store embedding — continuing without it");
  }
}

/**
 * Generate and store an embedding for a message asynchronously.
 * Returns immediately without awaiting — designed to be fire-and-forget.
 */
export function embedMessageAsync(
  messageId: number,
  threadId: number,
  profileId: number | null,
  content: string,
  apiKey: string,
): void {
  generateEmbedding(content, apiKey)
    .then((vec) => {
      if (vec) return storeEmbedding(messageId, threadId, profileId, vec);
      return undefined;
    })
    .catch((err) => logger.warn({ err, messageId }, "embedMessageAsync failed"));
}
