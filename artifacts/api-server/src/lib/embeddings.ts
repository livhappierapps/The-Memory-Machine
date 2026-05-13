/**
 * embeddings.ts — Embedding generation and storage service.
 *
 * Uses the xAI API (OpenAI-compatible) to generate text-embedding-3-small
 * vectors. All embedding work runs through a bounded-concurrency queue
 * (MAX_CONCURRENCY slots) with exponential-backoff retry on 429s, so
 * bulk imports never flood the xAI API with thousands of parallel requests.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIM = 1536;
const PROVIDER_ENDPOINTS: Record<string, string> = {
  xai: "https://api.x.ai/v1/embeddings",
  openai: "https://api.openai.com/v1/embeddings",
};

/** Maximum simultaneous embedding API calls. */
const MAX_CONCURRENCY = 4;
/** Maximum retry attempts per job (on 429 / transient network errors). */
const MAX_RETRIES = 3;
/** Base backoff in ms; actual delay = BASE_BACKOFF * 2^attempt. */
const BASE_BACKOFF_MS = 2_000;

// ── Internal bounded-concurrency queue ──────────────────────────────────────

type EmbedJob = () => Promise<void>;

let _active = 0;
const _queue: EmbedJob[] = [];

function _drain(): void {
  while (_active < MAX_CONCURRENCY && _queue.length > 0) {
    const job = _queue.shift()!;
    _active++;
    job()
      .catch((err) => logger.warn({ err }, "EmbeddingQueue job threw unexpectedly"))
      .finally(() => {
        _active--;
        _drain();
      });
  }
}

function _enqueue(job: EmbedJob): void {
  _queue.push(job);
  _drain();
}

// ── Embedding generation ─────────────────────────────────────────────────────

/** Result from a single embedding API call. */
interface EmbedResult {
  vector: number[] | null;
  /** True when the server returned 429 — caller should retry with backoff. */
  rateLimited: boolean;
}

async function _callEmbeddingApi(
  text: string,
  apiKey: string,
  provider: string,
): Promise<EmbedResult> {
  const input = text.slice(0, 8_000).trim();
  if (!input) return { vector: null, rateLimited: false };

  const endpointUrl = PROVIDER_ENDPOINTS[provider] ?? PROVIDER_ENDPOINTS["xai"]!;

  try {
    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input }),
    });

    if (response.status === 429) {
      return { vector: null, rateLimited: true };
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.warn(
        { status: response.status, body: body.slice(0, 200) },
        "Embedding API error — skipping this message",
      );
      return { vector: null, rateLimited: false };
    }

    const data = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const vec = data.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) {
      logger.warn({ vecLen: vec?.length }, "Unexpected embedding dimension — skipping");
      return { vector: null, rateLimited: false };
    }

    return { vector: vec, rateLimited: false };
  } catch (err) {
    logger.warn({ err }, "Failed to call embeddings API — skipping");
    return { vector: null, rateLimited: false };
  }
}

/** Generate an embedding vector with retry/backoff on rate-limits. */
export async function generateEmbedding(
  text: string,
  apiKey: string,
  provider = "xai",
): Promise<number[] | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const { vector, rateLimited } = await _callEmbeddingApi(text, apiKey, provider);
    if (vector) return vector;
    if (!rateLimited) return null; // permanent error — don't retry

    const delay = BASE_BACKOFF_MS * Math.pow(2, attempt);
    logger.warn({ attempt, delay }, "Rate-limited by embedding API — backing off");
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  logger.warn({ text: text.slice(0, 60) }, "Embedding retries exhausted — skipping");
  return null;
}

// ── Storage ──────────────────────────────────────────────────────────────────

/**
 * Persist an embedding vector to the DB.
 * Uses ON CONFLICT (message_id) which requires the UNIQUE constraint on that
 * column (created by db-bootstrap.ts).
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

// ── Public fire-and-forget API ───────────────────────────────────────────────

/**
 * Enqueue a generate+store embedding job. Returns immediately — all work
 * happens through the bounded queue (MAX_CONCURRENCY parallel requests max).
 */
export function embedMessageAsync(
  messageId: number,
  threadId: number,
  profileId: number | null,
  content: string,
  apiKey: string,
  provider = "xai",
): void {
  _enqueue(async () => {
    const vec = await generateEmbedding(content, apiKey, provider);
    if (vec) await storeEmbedding(messageId, threadId, profileId, vec);
  });
}
