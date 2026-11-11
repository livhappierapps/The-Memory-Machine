// Embedding generation and storage — bounded queue with retry.

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
/** Maximum retry attempts per job (on 429). */
const MAX_RETRIES = 3;
/** Base backoff in ms; actual delay = BASE_BACKOFF * 2^attempt. */
const BASE_BACKOFF_MS = 2_000;

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

/** Detailed outcome for callers that need to persist permanent failures. */
export interface EmbeddingResult {
  vector: number[] | null;
  /** HTTP 4xx, except retryable timeouts (408), too-early (425), and limits (429). */
  permanentFailure: boolean;
  status?: number;
}

/** Result from a single embedding API call. */
interface EmbedResult extends EmbeddingResult {
  /** True when the server returned 429 — caller should retry with backoff. */
  rateLimited: boolean;
}

async function _callEmbeddingApi(
  text: string,
  apiKey: string,
  provider: string,
): Promise<EmbedResult> {
  const input = text.slice(0, 8_000).trim();
  if (!input) return { vector: null, rateLimited: false, permanentFailure: false };

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
      return { vector: null, rateLimited: true, permanentFailure: false, status: 429 };
    }

    if (!response.ok) {
      logger.warn(
        { status: response.status },
        "Embedding API error — skipping this message",
      );
      return {
        vector: null,
        rateLimited: false,
        permanentFailure:
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 408 &&
          response.status !== 425,
        status: response.status,
      };
    }

    const data = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const vec = data.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) {
      logger.warn({ vecLen: vec?.length }, "Unexpected embedding dimension — skipping");
      return { vector: null, rateLimited: false, permanentFailure: false };
    }

    return { vector: vec, rateLimited: false, permanentFailure: false };
  } catch (err) {
    logger.warn({ err }, "Failed to call embeddings API — skipping");
    return { vector: null, rateLimited: false, permanentFailure: false };
  }
}

/** Generate an embedding vector with retry/backoff on rate-limits. */
export async function generateEmbedding(
  text: string,
  apiKey: string,
  provider = "xai",
): Promise<number[] | null> {
  return (await generateEmbeddingResult(text, apiKey, provider)).vector;
}

/** Preserve failure classification without changing the vector-only public API. */
export async function generateEmbeddingResult(
  text: string,
  apiKey: string,
  provider = "xai",
): Promise<EmbeddingResult> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const { rateLimited, ...result } = await _callEmbeddingApi(text, apiKey, provider);
    if (result.vector || !rateLimited) return result;

    const delay = BASE_BACKOFF_MS * Math.pow(2, attempt);
    logger.warn({ attempt, delay }, "Rate-limited by embedding API — backing off");
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  logger.warn("Embedding retries exhausted — skipping");
  return { vector: null, permanentFailure: false, status: 429 };
}

// ── Storage ──────────────────────────────────────────────────────────────────

/**
 * Persist an embedding vector to the DB.
 * Uses ON CONFLICT (message_id) which requires the UNIQUE constraint on that
 * column (created by db-bootstrap.ts).
 *
 * Returns true if the row was written, false if the DB write failed.
 * Errors are logged but not re-thrown so callers can branch on the result
 * without wrapping in try/catch.
 */
export async function storeEmbedding(
  messageId: number,
  threadId: number,
  profileId: number | null,
  vector: number[],
): Promise<boolean> {
  try {
    const vecLiteral = `[${vector.join(",")}]`;
    await db.execute(
      sql`
        INSERT INTO embeddings (message_id, thread_id, profile_id, embedding)
        VALUES (${messageId}, ${threadId}, ${profileId}, ${vecLiteral}::vector)
        ON CONFLICT (message_id) DO UPDATE SET embedding = EXCLUDED.embedding
      `,
    );
    return true;
  } catch (err) {
    logger.warn({ err, messageId }, "Failed to store embedding — continuing without it");
    return false;
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
