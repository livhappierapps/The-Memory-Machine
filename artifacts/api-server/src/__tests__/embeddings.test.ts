/**
 * embeddings.test.ts — Unit tests for the embedding generation and queue.
 *
 * Covers:
 *   generateEmbedding():
 *     1. Returns vector on successful first call
 *     2. Returns null for empty / whitespace-only input (no fetch)
 *     3. Returns null on a permanent API error (non-429) — no retry
 *     4. Retries on 429 and succeeds on the second attempt
 *     5. Exhausts MAX_RETRIES and returns null after all 429s
 *     6. Returns null when the embedding dimension is wrong
 *     7. Returns null when fetch throws a network error
 *     8. Returns null when the API body is missing the data array
 *
 *   storeEmbedding():
 *     9. Returns true when db.execute succeeds
 *    10. Returns false (no throw) when db.execute rejects
 *
 *   embedMessageAsync — fire-and-forget queue:
 *    11. Returns undefined synchronously
 *    12. All enqueued jobs eventually fire
 *
 * Fetch is stubbed globally per test. setTimeout is stubbed to resolve
 * immediately so retry backoff delays don't slow the suite.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { db } from "@workspace/db";
import { generateEmbedding, generateEmbeddingResult, storeEmbedding, embedMessageAsync } from "../lib/embeddings.js";

// ── Constants mirrored from embeddings.ts (keep in sync) ─────────────────────
const EMBEDDING_DIM = 1536;
const MAX_RETRIES = 3;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal successful embedding API response body. */
function makeSuccessBody(vector: number[] = new Array(EMBEDDING_DIM).fill(0.1)) {
  return JSON.stringify({ data: [{ embedding: vector }] });
}

/** Build a fetch Response with given status and body. */
function makeFetchResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  // Stub setTimeout to resolve callbacks immediately so retry backoffs are instant.
  // The retry logic uses `await new Promise(r => setTimeout(r, delay))` — this
  // makes those awaits resolve in the same microtask turn.
  vi.stubGlobal(
    "setTimeout",
    (fn: (...args: unknown[]) => void, _delay?: number, ...args: unknown[]) => {
      fn(...args);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── generateEmbedding — success path ─────────────────────────────────────────

describe("generateEmbedding — success path", () => {
  it("returns a number[] vector when the API responds with HTTP 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeFetchResponse(200, makeSuccessBody())));

    const vec = await generateEmbedding("hello world", "fake-key", "xai");

    expect(Array.isArray(vec)).toBe(true);
    expect(vec).toHaveLength(EMBEDDING_DIM);
  });

  it("passes the API key in the Authorization header", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse(200, makeSuccessBody()));
    vi.stubGlobal("fetch", mockFetch);

    await generateEmbedding("test text", "my-secret-key", "xai");

    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((callArgs[1].headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer my-secret-key",
    );
  });

  it("truncates input to 8000 characters before sending", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse(200, makeSuccessBody()));
    vi.stubGlobal("fetch", mockFetch);

    const longText = "x".repeat(12_000);
    await generateEmbedding(longText, "fake-key", "xai");

    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.input.length).toBeLessThanOrEqual(8_000);
  });

  it("uses the openai endpoint when provider='openai'", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse(200, makeSuccessBody()));
    vi.stubGlobal("fetch", mockFetch);

    await generateEmbedding("test", "fake-key", "openai");

    const url = (mockFetch.mock.calls[0] as [string, RequestInit])[0];
    expect(url).toContain("openai.com");
  });

  it("uses the xai endpoint when provider='xai'", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse(200, makeSuccessBody()));
    vi.stubGlobal("fetch", mockFetch);

    await generateEmbedding("test", "fake-key", "xai");

    const url = (mockFetch.mock.calls[0] as [string, RequestInit])[0];
    expect(url).toContain("x.ai");
  });
});

// ── generateEmbedding — null / skip cases ────────────────────────────────────

describe("generateEmbedding — null / skip cases", () => {
  it("returns null for empty string without calling fetch", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const result = await generateEmbedding("", "fake-key");

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null for whitespace-only input without calling fetch", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const result = await generateEmbedding("   \n\t  ", "fake-key");

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null on a server error without an immediate retry", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(makeFetchResponse(500, JSON.stringify({ error: "Internal server error" })));
    vi.stubGlobal("fetch", mockFetch);

    const result = await generateEmbedding("some text", "fake-key");

    expect(result).toBeNull();
    // Server errors remain eligible for a future startup sweep.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns null when response vector has wrong dimension", async () => {
    const wrongDimBody = JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeFetchResponse(200, wrongDimBody)));

    const result = await generateEmbedding("dimension test", "fake-key");

    expect(result).toBeNull();
  });

  it("returns null when fetch throws a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const result = await generateEmbedding("network error", "fake-key");

    expect(result).toBeNull();
  });

  it("returns null when the API response body is missing the data array", async () => {
    const badBody = JSON.stringify({ result: "no data field here" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeFetchResponse(200, badBody)));

    const result = await generateEmbedding("missing data", "fake-key");

    expect(result).toBeNull();
  });

  it("returns null for a 401 unauthorized response without retry", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(makeFetchResponse(401, JSON.stringify({ error: "Unauthorized" })));
    vi.stubGlobal("fetch", mockFetch);

    const result = await generateEmbedding("auth check", "bad-key");

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("generateEmbeddingResult — permanent failure classification", () => {
  it.each([400, 413, 422, 499])(
    "classifies HTTP %i as permanent (per-message) without retrying",
    async (status) => {
      const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse(status, "provider error"));
      vi.stubGlobal("fetch", mockFetch);

      expect(await generateEmbeddingResult("content", "fake-key")).toMatchObject({
        vector: null,
        permanentFailure: true,
        configError: false,
        status,
        modelKey: "xai:v1:1536",
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    },
  );

  // Auth / wrong-model errors affect every message; they must never be
  // persisted per-message in embed_attempts.
  it.each([401, 402, 403, 404])(
    "classifies HTTP %i as a config error (not permanent) without retrying",
    async (status) => {
      const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse(status, "provider error"));
      vi.stubGlobal("fetch", mockFetch);

      expect(await generateEmbeddingResult("content", "fake-key")).toMatchObject({
        vector: null,
        permanentFailure: false,
        configError: true,
        status,
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([408, 425, 429, 500, 503])("does not mark HTTP %i as permanent", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeFetchResponse(status, "")));
    expect(await generateEmbeddingResult("content", "fake-key")).toMatchObject({
      vector: null,
      permanentFailure: false,
      status,
    });
  });

  it("does not mark network errors as permanent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    expect(await generateEmbeddingResult("content", "fake-key")).toMatchObject({
      vector: null,
      permanentFailure: false,
    });
  });

  it.each(["{}", '{"data":[{"embedding":[1]}]}', "not JSON"])(
    "does not mark malformed successful responses as permanent: %s",
    async (body) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeFetchResponse(200, body)));
      expect(await generateEmbeddingResult("content", "fake-key")).toMatchObject({
        vector: null,
        permanentFailure: false,
      });
    },
  );

  it("returns the vector with no permanent failure on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeFetchResponse(200, makeSuccessBody())));
    const result = await generateEmbeddingResult("content", "fake-key");
    expect(result.permanentFailure).toBe(false);
    expect(result.vector).toHaveLength(EMBEDDING_DIM);
  });
});

// ── generateEmbedding — 429 retry / backoff ───────────────────────────────────

describe("generateEmbedding — 429 retry / backoff", () => {
  // Note: setTimeout is stubbed in beforeEach to resolve immediately, so backoff
  // delays don't slow the suite. This lets us test retry counts without waiting.

  it("retries once on 429 and returns the vector on the second call", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse(429, ""))
      .mockResolvedValueOnce(makeFetchResponse(200, makeSuccessBody()));
    vi.stubGlobal("fetch", mockFetch);

    const result = await generateEmbedding("rate limited text", "fake-key");

    expect(result).not.toBeNull();
    expect(result).toHaveLength(EMBEDDING_DIM);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("retries twice on back-to-back 429s and succeeds on the third call", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse(429, ""))
      .mockResolvedValueOnce(makeFetchResponse(429, ""))
      .mockResolvedValueOnce(makeFetchResponse(200, makeSuccessBody()));
    vi.stubGlobal("fetch", mockFetch);

    const result = await generateEmbedding("double retry", "fake-key");

    expect(result).not.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("returns null after exhausting all retries on repeated 429s", async () => {
    // All calls return 429 — should give up after MAX_RETRIES+1 total attempts
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeFetchResponse(429, "")));

    const result = await generateEmbedding("always rate limited", "fake-key");

    expect(result).toBeNull();
  });

  it("makes exactly MAX_RETRIES+1 fetch calls before giving up on all-429 responses", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse(429, ""));
    vi.stubGlobal("fetch", mockFetch);

    await generateEmbedding("count retries", "fake-key");

    // initial attempt + MAX_RETRIES retries
    expect(mockFetch).toHaveBeenCalledTimes(MAX_RETRIES + 1);
  });

  it("does not retry a permanent error that follows a 429", async () => {
    // First call: 429 (retry). Second call: 500 permanent (no further retry).
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse(429, ""))
      .mockResolvedValueOnce(makeFetchResponse(500, JSON.stringify({ error: "server error" })));
    vi.stubGlobal("fetch", mockFetch);

    const result = await generateEmbedding("mixed errors", "fake-key");

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ── storeEmbedding ────────────────────────────────────────────────────────────

describe("storeEmbedding", () => {
  it("returns true when db.execute succeeds", async () => {
    const executeSpy = vi.spyOn(db, "execute").mockResolvedValueOnce({ rows: [] } as any);

    const vector = new Array(EMBEDDING_DIM).fill(0.1);
    const result = await storeEmbedding(1, 10, 5, vector);

    expect(result).toBe(true);
    executeSpy.mockRestore();
  });

  it("returns false (does not throw) when db.execute rejects", async () => {
    const executeSpy = vi
      .spyOn(db, "execute")
      .mockRejectedValueOnce(new Error("DB connection lost"));

    const vector = new Array(EMBEDDING_DIM).fill(0.1);
    const result = await storeEmbedding(999, 10, 5, vector);

    expect(result).toBe(false);
    executeSpy.mockRestore();
  });

  it("builds the vector literal as [n1,n2,...] and passes it to db.execute", async () => {
    const executeSpy = vi.spyOn(db, "execute").mockResolvedValueOnce({ rows: [] } as any);

    const vector = [0.1, 0.2, 0.3];
    await storeEmbedding(42, 7, 3, vector);

    expect(executeSpy).toHaveBeenCalledTimes(1);
    // The SQL object should contain the vector literal in its params
    const sqlArg = JSON.stringify(executeSpy.mock.calls[0]![0]);
    expect(sqlArg).toContain("0.1,0.2,0.3");

    executeSpy.mockRestore();
  });
});

// ── embedMessageAsync — fire-and-forget queue ────────────────────────────────

describe("embedMessageAsync — fire-and-forget queue", () => {
  it("returns undefined synchronously (fire-and-forget)", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeFetchResponse(200, makeSuccessBody())));
    vi.spyOn(db, "execute").mockResolvedValue({ rows: [] } as any);

    // The call must return synchronously without blocking
    const start = Date.now();
    const ret = embedMessageAsync(1, 10, 5, "content to embed", "fake-key", "xai");
    const elapsed = Date.now() - start;

    expect(ret).toBeUndefined();
    expect(elapsed).toBeLessThan(50);
  });

  it("processes multiple enqueued jobs (all generateEmbedding calls eventually fire)", async () => {
    let fetchCallCount = 0;
    // Track each fetch as a resolvable promise so we can await them all
    const fetches: Promise<void>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        fetchCallCount++;
        const p = Promise.resolve(makeFetchResponse(200, makeSuccessBody()));
        fetches.push(p.then(() => undefined));
        return p;
      }),
    );
    vi.spyOn(db, "execute").mockResolvedValue({ rows: [] } as any);

    // Enqueue 4 jobs — within MAX_CONCURRENCY so all start immediately
    const JOB_COUNT = 4;
    for (let i = 0; i < JOB_COUNT; i++) {
      embedMessageAsync(i + 200, 10, 5, `message content ${i}`, "fake-key", "xai");
    }

    // Flush microtasks repeatedly to let all Promise chains settle
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
    await Promise.allSettled(fetches);

    expect(fetchCallCount).toBe(JOB_COUNT);
  });
});
