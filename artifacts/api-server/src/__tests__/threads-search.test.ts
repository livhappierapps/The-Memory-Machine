/**
 * threads-search.test.ts — Integration tests for GET /threads?search=
 *
 * Covers:
 *   1. Keyword-only fallback when generateEmbedding returns null (no API key /
 *      pgvector unavailable).
 *   2. Semantic results prioritised before keyword-only matches when the vector
 *      search returns thread IDs.
 *   3. Profile isolation — when a profileId filter is supplied, only threads
 *      from that profile appear and the vector SQL is scoped to that profile's
 *      embeddings.
 *   4. Empty result set when nothing matches (returns [] not 404).
 *
 * Auth is bypassed via vi.mock so tests don't need a live Clerk session.
 * generateEmbedding and isPgvectorAvailable are mocked so tests are hermetic
 * and don't need a real embedding API or pgvector extension.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import cookieParser from "cookie-parser";

// ── Mocks (must be hoisted before module imports) ─────────────────────────────

const TEST_USER_ID = "test-user-threads-search-integration";

vi.mock("../middlewares/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).userId = TEST_USER_ID;
    next();
  },
}));

// Control pgvector availability and embedding output per-test
const mockIsPgvectorAvailable = vi.fn().mockReturnValue(false);
vi.mock("../lib/db-bootstrap.js", () => ({
  isPgvectorAvailable: () => mockIsPgvectorAvailable(),
  bootstrapDb: vi.fn().mockResolvedValue(undefined),
}));

const mockGenerateEmbedding = vi.fn().mockResolvedValue(null);
vi.mock("../lib/embeddings.js", () => ({
  generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args),
  storeEmbedding: vi.fn().mockResolvedValue(true),
  embedMessageAsync: vi.fn(),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { db, threadsTable, profilesTable, settingsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import threadsRouter from "../routes/threads.js";
import { encryptField } from "../lib/field-crypto.js";

// ── App builder ───────────────────────────────────────────────────────────────

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req: any, _res: Response, next: NextFunction) => {
    req.log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  app.use(threadsRouter);
  return app;
}

// ── Test state ────────────────────────────────────────────────────────────────

let profileId: number;
let profileId2: number;
/** Thread that matches keyword search — title contains the search term. */
let keywordThreadId: number;
/** Thread whose title does NOT contain the search term (semantic-only hit). */
let semanticOnlyThreadId: number;
/** Thread belonging to a second profile (should be excluded when profileId filter used). */
let otherProfileThreadId: number;

const SEARCH_TERM = "vitest-search-unique-alpha9x";
const SEMANTIC_ONLY_TITLE = "vitest-search-semantic-unrelated-title-beta8y";

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  // Profile 1 — has an encrypted API key so the embedding path can be reached
  const [p1] = await db
    .insert(profilesTable)
    .values({
      userId: TEST_USER_ID,
      name: "Search Test Profile",
      apiKey: encryptField(TEST_USER_ID, "fake-key-for-search-tests"),
      embeddingProvider: "xai",
    })
    .returning({ id: profilesTable.id });
  profileId = p1!.id;

  // Profile 2 — second profile for isolation tests
  const [p2] = await db
    .insert(profilesTable)
    .values({
      userId: TEST_USER_ID,
      name: "Search Test Profile 2",
      apiKey: null,
      embeddingProvider: "xai",
    })
    .returning({ id: profilesTable.id });
  profileId2 = p2!.id;

  // Thread whose title matches the keyword
  const [kt] = await db
    .insert(threadsTable)
    .values({
      userId: TEST_USER_ID,
      profileId,
      title: `Conversation about ${SEARCH_TERM}`,
      model: "grok-3",
    })
    .returning({ id: threadsTable.id });
  keywordThreadId = kt!.id;

  // Thread whose title does NOT match — simulates a semantic-only hit
  const [st] = await db
    .insert(threadsTable)
    .values({
      userId: TEST_USER_ID,
      profileId,
      title: SEMANTIC_ONLY_TITLE,
      model: "grok-3",
    })
    .returning({ id: threadsTable.id });
  semanticOnlyThreadId = st!.id;

  // Thread for the second profile — must be excluded by profile filter
  const [ot] = await db
    .insert(threadsTable)
    .values({
      userId: TEST_USER_ID,
      profileId: profileId2,
      title: `Other-profile conversation about ${SEARCH_TERM}`,
      model: "grok-3",
    })
    .returning({ id: threadsTable.id });
  otherProfileThreadId = ot!.id;
});

afterAll(async () => {
  // Clean up all test data in dependency order
  await db.delete(threadsTable).where(eq(threadsTable.userId, TEST_USER_ID));
  await db.delete(profilesTable).where(eq(profilesTable.userId, TEST_USER_ID));
});

beforeEach(() => {
  mockIsPgvectorAvailable.mockReturnValue(false);
  mockGenerateEmbedding.mockResolvedValue(null);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /threads?search= — hybrid semantic + keyword search", () => {
  it("returns threads whose title matches the keyword when pgvector is unavailable", async () => {
    mockIsPgvectorAvailable.mockReturnValue(false);

    const app = buildTestApp();
    const res = await request(app)
      .get(`/threads?search=${encodeURIComponent(SEARCH_TERM)}`)
      .expect(200);

    const ids = res.body.map((t: { id: number }) => t.id);
    expect(ids).toContain(keywordThreadId);
    expect(ids).not.toContain(semanticOnlyThreadId);
  });

  it("returns empty array when no title matches and pgvector is unavailable", async () => {
    mockIsPgvectorAvailable.mockReturnValue(false);

    const app = buildTestApp();
    const res = await request(app)
      .get("/threads?search=zzz-this-term-matches-nothing-xyz-q9q9q")
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it("places semantic-only results before keyword-only results when vector search returns IDs", async () => {
    mockIsPgvectorAvailable.mockReturnValue(true);
    // Return a fake unit vector so the embedding path proceeds
    mockGenerateEmbedding.mockResolvedValue(new Array(1536).fill(0.1));

    // Spy on db.execute so we can control the pgvector query result without
    // needing a real pgvector extension in CI.
    const executeSpy = vi.spyOn(db, "execute").mockResolvedValueOnce({
      rows: [{ thread_id: semanticOnlyThreadId }],
    } as any);

    const app = buildTestApp();
    const res = await request(app)
      .get(`/threads?search=${encodeURIComponent(SEARCH_TERM)}`)
      .expect(200);

    executeSpy.mockRestore();

    const ids = res.body.map((t: { id: number }) => t.id);
    // Semantic hit must appear, keyword hit must appear
    expect(ids).toContain(semanticOnlyThreadId);
    expect(ids).toContain(keywordThreadId);
    // Semantic hit must come before the keyword-only hit
    expect(ids.indexOf(semanticOnlyThreadId)).toBeLessThan(ids.indexOf(keywordThreadId));
  });

  it("falls back to keyword-only when generateEmbedding times out / returns null", async () => {
    mockIsPgvectorAvailable.mockReturnValue(true);
    mockGenerateEmbedding.mockResolvedValue(null); // simulate timeout/failure

    const app = buildTestApp();
    const res = await request(app)
      .get(`/threads?search=${encodeURIComponent(SEARCH_TERM)}`)
      .expect(200);

    const ids = res.body.map((t: { id: number }) => t.id);
    expect(ids).toContain(keywordThreadId);
    // Semantic-only thread should NOT appear (no vector, no keyword match)
    expect(ids).not.toContain(semanticOnlyThreadId);
  });

  it("scopes results to the requested profile — threads from other profiles are excluded", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .get(`/threads?search=${encodeURIComponent(SEARCH_TERM)}&profileId=${profileId}`)
      .expect(200);

    const ids = res.body.map((t: { id: number }) => t.id);
    expect(ids).toContain(keywordThreadId);
    // Thread from profile 2 must not appear even though its title also matches
    expect(ids).not.toContain(otherProfileThreadId);
  });

  it("returns threads from a different profile when that profile is filtered", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .get(`/threads?search=${encodeURIComponent(SEARCH_TERM)}&profileId=${profileId2}`)
      .expect(200);

    const ids = res.body.map((t: { id: number }) => t.id);
    expect(ids).toContain(otherProfileThreadId);
    expect(ids).not.toContain(keywordThreadId);
  });

  it("scopes the vector search db.execute call with the requested profile_id", async () => {
    mockIsPgvectorAvailable.mockReturnValue(true);
    mockGenerateEmbedding.mockResolvedValue(new Array(1536).fill(0.1));

    const executeSpy = vi.spyOn(db, "execute").mockResolvedValueOnce({
      rows: [],
    } as any);

    const app = buildTestApp();
    await request(app)
      .get(`/threads?search=${encodeURIComponent(SEARCH_TERM)}&profileId=${profileId}`)
      .expect(200);

    // Verify the SQL sent to execute contains the profile_id as a bound parameter.
    // Drizzle sql`` returns an object — JSON.stringify surfaces the bound values.
    expect(executeSpy).toHaveBeenCalled();
    const sqlArg = JSON.stringify((executeSpy.mock.calls[0] as any[])[0]);
    expect(sqlArg).toContain(String(profileId));

    executeSpy.mockRestore();
  });

  it("unpinned semantic hit ranks before pinned keyword-only hit", async () => {
    // A pinned keyword-match thread + an unpinned semantic-only thread.
    // Semantic group must still come first regardless of pin status.
    const [pinnedKw] = await db
      .insert(threadsTable)
      .values({
        userId: TEST_USER_ID,
        profileId,
        title: `Pinned keyword thread about ${SEARCH_TERM}`,
        model: "grok-3",
        pinned: true,
      })
      .returning({ id: threadsTable.id });
    const [unpinnedSem] = await db
      .insert(threadsTable)
      .values({
        userId: TEST_USER_ID,
        profileId,
        title: "vitest-unpinned-semantic-only-rank-test-gamma3z",
        model: "grok-3",
        pinned: false,
      })
      .returning({ id: threadsTable.id });

    try {
      mockIsPgvectorAvailable.mockReturnValue(true);
      mockGenerateEmbedding.mockResolvedValue(new Array(1536).fill(0.1));

      // Simulate vector search returning only the unpinned semantic thread
      const executeSpy = vi.spyOn(db, "execute").mockResolvedValueOnce({
        rows: [{ thread_id: unpinnedSem!.id }],
      } as any);

      const app = buildTestApp();
      const res = await request(app)
        .get(`/threads?search=${encodeURIComponent(SEARCH_TERM)}`)
        .expect(200);

      executeSpy.mockRestore();

      const ids = res.body.map((t: { id: number }) => t.id);
      expect(ids).toContain(unpinnedSem!.id);
      expect(ids).toContain(pinnedKw!.id);
      // Unpinned semantic must appear before pinned keyword-only
      expect(ids.indexOf(unpinnedSem!.id)).toBeLessThan(ids.indexOf(pinnedKw!.id));
    } finally {
      await db.delete(threadsTable).where(
        inArray(threadsTable.id, [pinnedKw!.id, unpinnedSem!.id]),
      );
    }
  });

  it("within the semantic group, higher-score unpinned result ranks above lower-score pinned result", async () => {
    // Two semantic hits: one pinned with lower similarity, one unpinned with higher similarity.
    // Score must be the primary ordering within the semantic group — pin is only a tie-break.
    const [highScoreSem] = await db
      .insert(threadsTable)
      .values({
        userId: TEST_USER_ID,
        profileId,
        title: "vitest-high-score-semantic-delta1a",
        model: "grok-3",
        pinned: false, // unpinned but highest score
      })
      .returning({ id: threadsTable.id });
    const [lowScoreSem] = await db
      .insert(threadsTable)
      .values({
        userId: TEST_USER_ID,
        profileId,
        title: "vitest-low-score-semantic-delta2b",
        model: "grok-3",
        pinned: true, // pinned but lowest score
      })
      .returning({ id: threadsTable.id });

    try {
      mockIsPgvectorAvailable.mockReturnValue(true);
      mockGenerateEmbedding.mockResolvedValue(new Array(1536).fill(0.1));

      // Vector search returns high-score result first (index 0 = best match)
      const executeSpy = vi.spyOn(db, "execute").mockResolvedValueOnce({
        rows: [{ thread_id: highScoreSem!.id }, { thread_id: lowScoreSem!.id }],
      } as any);

      const app = buildTestApp();
      const res = await request(app)
        .get(`/threads?search=${encodeURIComponent(SEARCH_TERM)}`)
        .expect(200);

      executeSpy.mockRestore();

      const ids = res.body.map((t: { id: number }) => t.id);
      expect(ids).toContain(highScoreSem!.id);
      expect(ids).toContain(lowScoreSem!.id);
      // Higher-score (index 0) must appear before lower-score (index 1) regardless of pin
      expect(ids.indexOf(highScoreSem!.id)).toBeLessThan(ids.indexOf(lowScoreSem!.id));
    } finally {
      await db.delete(threadsTable).where(
        inArray(threadsTable.id, [highScoreSem!.id, lowScoreSem!.id]),
      );
    }
  });

  it("applies active filters inside the vector SQL candidate query", async () => {
    mockIsPgvectorAvailable.mockReturnValue(true);
    mockGenerateEmbedding.mockResolvedValue(new Array(1536).fill(0.1));

    const executeSpy = vi.spyOn(db, "execute").mockResolvedValueOnce({
      rows: [],
    } as any);

    const app = buildTestApp();
    // Search with source=mcp filter active — the vector SQL must include this constraint
    await request(app)
      .get(`/threads?search=${encodeURIComponent(SEARCH_TERM)}&source=mcp`)
      .expect(200);

    expect(executeSpy).toHaveBeenCalled();
    // The SQL object's bound params must contain "mcp" for the source filter
    const sqlArg = JSON.stringify((executeSpy.mock.calls[0] as any[])[0]);
    expect(sqlArg).toContain("mcp");

    executeSpy.mockRestore();
  });

  it("keyword search scoped by profile — thread from other profile not returned even when title matches", async () => {
    // pgvector unavailable — keyword-only path. The keyword query must apply the
    // profile filter so the other-profile match is not included in mergedIds.
    mockIsPgvectorAvailable.mockReturnValue(false);

    const app = buildTestApp();
    const res = await request(app)
      .get(`/threads?search=${encodeURIComponent(SEARCH_TERM)}&profileId=${profileId}`)
      .expect(200);

    const ids = res.body.map((t: { id: number }) => t.id);
    // keyword thread (profile 1) must appear
    expect(ids).toContain(keywordThreadId);
    // other-profile thread's title also matches but must be excluded
    expect(ids).not.toContain(otherProfileThreadId);
  });

  it("uses the global settings API key for semantic search when the profile has no key", async () => {
    // Profile 2 has no API key. Insert a settings row with a key for this user.
    // The search path should fall back to that key and produce semantic candidates.
    const [settingsRow] = await db
      .insert(settingsTable)
      .values({
        userId: TEST_USER_ID,
        apiKey: encryptField(TEST_USER_ID, "fake-settings-key-for-fallback-test"),
      })
      .onConflictDoUpdate({
        target: settingsTable.userId,
        set: { apiKey: encryptField(TEST_USER_ID, "fake-settings-key-for-fallback-test") },
      })
      .returning({ userId: settingsTable.userId });

    try {
      mockIsPgvectorAvailable.mockReturnValue(true);
      mockGenerateEmbedding.mockResolvedValue(new Array(1536).fill(0.1));

      const executeSpy = vi.spyOn(db, "execute").mockResolvedValueOnce({
        rows: [{ thread_id: otherProfileThreadId }],
      } as any);

      const app = buildTestApp();
      const res = await request(app)
        .get(`/threads?search=${encodeURIComponent(SEARCH_TERM)}&profileId=${profileId2}`)
        .expect(200);

      executeSpy.mockRestore();

      // generateEmbedding must have been called (with the settings key as fallback)
      expect(mockGenerateEmbedding).toHaveBeenCalled();
      // The semantic-matched thread should appear in results
      const ids = res.body.map((t: { id: number }) => t.id);
      expect(ids).toContain(otherProfileThreadId);
    } finally {
      await db.delete(settingsTable).where(eq(settingsTable.userId, TEST_USER_ID));
    }
  });

  it("keyword search with source=mcp excludes chat-sourced threads that match the title", async () => {
    // Create a chat-sourced thread whose title matches the keyword and an mcp-sourced one
    const [chatThread] = await db
      .insert(threadsTable)
      .values({
        userId: TEST_USER_ID,
        profileId,
        title: `Chat thread about ${SEARCH_TERM}`,
        model: "grok-3",
        source: "chat",
      })
      .returning({ id: threadsTable.id });
    const [mcpThread] = await db
      .insert(threadsTable)
      .values({
        userId: TEST_USER_ID,
        profileId,
        title: `MCP note about ${SEARCH_TERM}`,
        model: "grok-3",
        source: "mcp",
      })
      .returning({ id: threadsTable.id });

    try {
      mockIsPgvectorAvailable.mockReturnValue(false);

      const app = buildTestApp();
      const res = await request(app)
        .get(`/threads?search=${encodeURIComponent(SEARCH_TERM)}&source=mcp`)
        .expect(200);

      const ids = res.body.map((t: { id: number }) => t.id);
      expect(ids).toContain(mcpThread!.id);
      expect(ids).not.toContain(chatThread!.id);
    } finally {
      await db.delete(threadsTable).where(
        inArray(threadsTable.id, [chatThread!.id, mcpThread!.id]),
      );
    }
  });
});
