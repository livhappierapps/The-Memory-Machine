/**
 * MCP embedding round-trip integration test.
 *
 * This test covers the path that silently breaks when an autoscale instance
 * shuts down before the background embedding job completes:
 *
 *   save_memory → embedding generated → stored in DB → search_memories
 *   returns the note with a semantic similarity score > 0
 *
 * The existing mcp-e2e.test.ts mocks generateEmbedding to return null, so
 * it only exercises the keyword-fallback path. This test mocks it to return
 * a real 1536-dimension unit vector, giving the embedding branch a chance to
 * run, then polls the embeddings table and asserts the full semantic path.
 *
 * Key invariant being tested:
 *   When a profile has an API key set, save_memory MUST store an embedding
 *   row within a bounded time window. If it does not (e.g. because the
 *   fire-and-forget Promise is never settled), search_memories will silently
 *   return a keyword-only result with score = 0 instead of a semantic result
 *   with score > 0 — and this test will catch the regression.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── Mocks — must be hoisted before any module that triggers them ──────────────

// storeEmbedding is NOT mocked here — we need it to actually write to the DB
// so we can poll for the row and confirm the full round-trip.
//
// IMPORTANT: vi.mock factories are hoisted to the top of the file by Vitest's
// transformer.  That means any variable referenced inside the factory must
// either be defined inside the factory itself, or be a vi.fn() placeholder
// that gets configured after imports.  We build the mock vector inline so it
// is available at hoist time.
vi.mock("../lib/embeddings.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/embeddings.js")>();
  // 1536-dimension unit vector: every component = 1/√1536
  // Cosine similarity against itself = 1.0 (distance = 0, score = 1 − 0 = 1.0)
  const unitValue = 1 / Math.sqrt(1536);
  const mockVector: number[] = Array.from({ length: 1536 }, () => unitValue);
  return {
    ...original,
    generateEmbedding: vi.fn().mockResolvedValue(mockVector),
    // embedMessageAsync is not called by the MCP route — keep real impl.
    embedMessageAsync: original.embedMessageAsync,
  };
});

// MCP route uses bearer-token auth; requireAuth is only used by app routes.
vi.mock("../middlewares/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).userId = TEST_USER_ID;
    next();
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { db, settingsTable, threadsTable, messagesTable, profilesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import mcpRouter from "../routes/mcp.js";
import { sha256Hex } from "../lib/field-crypto.js";
import { generateEmbedding } from "../lib/embeddings.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_USER_ID = "test-user-mcp-embedding-roundtrip";
const TEST_MCP_TOKEN = "mcp-embedding-roundtrip-token-vitest";

// Unique enough to guarantee this test's thread is the one returned.
const MEMORY_TITLE = "vitest-embedding-roundtrip-unique-beta9q";
const MEMORY_CONTENT =
  "Semantic round-trip verification: this note must be findable by vector similarity.";

// Polling: wait up to 5 s in 100 ms steps for the embedding to appear.
const POLL_INTERVAL_MS = 100;
const POLL_TIMEOUT_MS = 5_000;

// ── App builder ───────────────────────────────────────────────────────────────

function buildMcpApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: Response, next: NextFunction) => {
    req.log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  app.use(mcpRouter);
  return app;
}

// ── MCP JSON-RPC helpers ──────────────────────────────────────────────────────

function mcpCallBody(toolName: string, args: Record<string, unknown>, id = 1) {
  return {
    jsonrpc: "2.0",
    method: "tools/call",
    params: { name: toolName, arguments: args },
    id,
  };
}

function parseMcpResponse(
  body: string,
  contentType: string,
): { id: number; result?: { content: Array<{ type: string; text: string }> }; error?: unknown } | null {
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s) as {
        id: number;
        result?: { content: Array<{ type: string; text: string }> };
        error?: unknown;
      };
    } catch {
      return null;
    }
  };

  if (contentType.includes("text/event-stream")) {
    for (const line of body.split("\n")) {
      if (line.startsWith("data: ")) {
        const parsed = tryParse(line.slice(6));
        if (parsed && "id" in parsed) return parsed;
      }
    }
    return null;
  }

  return tryParse(body);
}

// ── DB polling helper ─────────────────────────────────────────────────────────

/**
 * Poll the embeddings table until a row for `threadId` appears or the timeout
 * elapses.  Returns the row count (0 = timed out without a row).
 *
 * The embedding is generated in a fire-and-forget Promise inside save_memory.
 * After the HTTP response returns the embedding may not yet be in the DB, so
 * we need to poll rather than check immediately.
 */
async function pollForEmbedding(
  threadId: number,
  timeoutMs = POLL_TIMEOUT_MS,
  intervalMs = POLL_INTERVAL_MS,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    type Row = { cnt: string };
    const result = await db.execute<Row>(
      sql`SELECT COUNT(*)::text AS cnt FROM embeddings WHERE thread_id = ${threadId}`,
    );
    const count = parseInt(result.rows[0]?.cnt ?? "0", 10);
    if (count > 0) return count;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return 0;
}

// ── Shared test state ─────────────────────────────────────────────────────────

let testProfileId: number;
let savedThreadId: number | null = null;

// ── Fixtures ──────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Insert a profile WITH a non-null apiKey so the save_memory embedding
  // branch is reached (it guards on `profile?.apiKey`).
  // The key value is fake — generateEmbedding is mocked and never calls out.
  const [profile] = await db
    .insert(profilesTable)
    .values({
      userId: TEST_USER_ID,
      name: "MCP Embedding Roundtrip Test Profile",
      emoji: "🔬",
      color: "#111111",
      apiKey: "fake-key-for-embedding-roundtrip-test",
    })
    .returning({ id: profilesTable.id });

  testProfileId = profile!.id;

  const tokenHash = sha256Hex(TEST_MCP_TOKEN);
  await db
    .insert(settingsTable)
    .values({
      userId: TEST_USER_ID,
      mcpToken: TEST_MCP_TOKEN,
      mcpTokenHash: tokenHash,
    })
    .onConflictDoUpdate({
      target: settingsTable.userId,
      set: { mcpToken: TEST_MCP_TOKEN, mcpTokenHash: tokenHash },
    });
});

afterAll(async () => {
  if (savedThreadId) {
    // embeddings are deleted via ON DELETE CASCADE when messages are deleted,
    // and messages are deleted when the thread is deleted below.
    await db.delete(messagesTable).where(eq(messagesTable.threadId, savedThreadId));
    await db.delete(threadsTable).where(eq(threadsTable.id, savedThreadId));
  }
  // Catch any stray threads with the same title (e.g. from a failed test run)
  const stray = await db
    .select({ id: threadsTable.id })
    .from(threadsTable)
    .where(and(eq(threadsTable.userId, TEST_USER_ID), eq(threadsTable.title, MEMORY_TITLE)));
  for (const t of stray) {
    await db.delete(messagesTable).where(eq(messagesTable.threadId, t.id));
    await db.delete(threadsTable).where(eq(threadsTable.id, t.id));
  }
  await db.delete(settingsTable).where(eq(settingsTable.userId, TEST_USER_ID));
  if (testProfileId) {
    await db.delete(profilesTable).where(eq(profilesTable.id, testProfileId));
  }
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MCP embedding round-trip — save → embedding stored → semantic search", () => {
  it("save_memory returns HTTP 200 and a thread ID", async () => {
    const res = await request(buildMcpApp())
      .post("/mcp")
      .set("Authorization", `Bearer ${TEST_MCP_TOKEN}`)
      .set("Accept", "application/json, text/event-stream")
      .send(
        mcpCallBody("save_memory", {
          title: MEMORY_TITLE,
          content: MEMORY_CONTENT,
          pin: true,
        }),
      );

    expect(res.status).toBe(200);

    const parsed = parseMcpResponse(res.text, res.headers["content-type"] ?? "");
    expect(parsed).not.toBeNull();
    expect(parsed!.error).toBeUndefined();
    expect(parsed!.result).toBeDefined();

    const responseText = parsed!.result!.content[0]?.text ?? "";
    const idMatch = responseText.match(/ID:\s*#?(\d+)/);
    expect(idMatch, "Response should contain the thread ID").not.toBeNull();

    savedThreadId = parseInt(idMatch![1]!, 10);
    expect(savedThreadId).toBeGreaterThan(0);
  });

  it("generateEmbedding was called with the memory content (embedding branch fired)", () => {
    // This assertion verifies that the profile's apiKey was picked up and the
    // embedding code path was entered — not silently skipped.
    const mockFn = generateEmbedding as ReturnType<typeof vi.fn>;
    expect(mockFn).toHaveBeenCalled();

    const firstCall = mockFn.mock.calls[0];
    expect(typeof firstCall?.[0]).toBe("string");
    expect((firstCall![0] as string).includes(MEMORY_CONTENT)).toBe(true);
  });

  it("embedding row appears in the DB within the polling window (fire-and-forget settled)", async () => {
    expect(savedThreadId, "save_memory must succeed before this test runs").not.toBeNull();

    const count = await pollForEmbedding(savedThreadId!);
    expect(
      count,
      `Expected at least 1 embedding row for thread ${savedThreadId} within ${POLL_TIMEOUT_MS} ms — the fire-and-forget Promise did not settle in time`,
    ).toBeGreaterThan(0);
  });

  it("search_memories returns the saved note with similarity score > 0 (semantic path)", async () => {
    expect(savedThreadId, "save_memory must succeed before this test runs").not.toBeNull();

    // The mock returns the same unit vector for every generateEmbedding call,
    // so the cosine similarity between the stored embedding and the query
    // embedding is 1.0 — well above the 0.3 threshold in search_memories.
    const res = await request(buildMcpApp())
      .post("/mcp")
      .set("Authorization", `Bearer ${TEST_MCP_TOKEN}`)
      .set("Accept", "application/json, text/event-stream")
      .send(
        mcpCallBody(
          "search_memories",
          { query: "semantic round-trip verification note", limit: 5 },
          20,
        ),
      );

    expect(res.status).toBe(200);

    const parsed = parseMcpResponse(res.text, res.headers["content-type"] ?? "");
    expect(parsed).not.toBeNull();
    expect(parsed!.error).toBeUndefined();

    const responseText = parsed!.result!.content[0]?.text ?? "";

    // The thread must appear in the results
    expect(
      responseText,
      "search_memories should return the saved thread",
    ).toContain(`#${savedThreadId}`);

    // A similarity score must be present and > 0 — proving the vector path
    // was taken and not just the keyword fallback (which has score = 0).
    const simMatch = responseText.match(/similarity:\s*(\d+)%/);
    expect(
      simMatch,
      "Response should include a similarity percentage — if missing, the semantic search path was not taken",
    ).not.toBeNull();

    const similarityPct = parseInt(simMatch![1]!, 10);
    expect(
      similarityPct,
      `Similarity score should be > 0 (got ${similarityPct}%) — the vector search returned no meaningful result`,
    ).toBeGreaterThan(0);
  });
});
