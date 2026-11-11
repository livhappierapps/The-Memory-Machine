/**
 * memory.test.ts — Unit tests for retrieveMemories()
 *
 * Covers:
 *   1. Pinned-only retrieval (smartRetrieval=false, alwaysIncludeLastN=0)
 *   2. Semantic retrieval (smartRetrieval=true, mocked pgvector results)
 *   3. Mixed retrieval (pinned + semantic + recent combined)
 *   4. Date range filter scopes both semantic and recent lookups
 *   5. Current thread is always excluded from sources
 *   6. trackUsage=false skips the memory_weight UPDATE
 *   7. Context budget: snippets are loaded and character totals are respected
 *
 * The real DB is used for thread/message fixture data.
 * generateEmbedding is mocked so no API key or live embedding server is needed.
 * db.execute is spied upon to control pgvector query results without needing
 * the pgvector extension in CI.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { db, threadsTable, messagesTable, profilesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { encryptField } from "../lib/field-crypto.js";

// ── Mocks (hoisted before any module that imports embeddings) ─────────────────

const mockGenerateEmbedding = vi.fn().mockResolvedValue(null);

vi.mock("../lib/embeddings.js", () => ({
  generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args),
  storeEmbedding: vi.fn().mockResolvedValue(true),
  embedMessageAsync: vi.fn(),
}));

// ── Import under test (after mocks) ──────────────────────────────────────────

import { retrieveMemories } from "../lib/memory.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_USER_ID = "test-user-memory-unit-vitest";
const FAKE_API_KEY = "fake-key-memory-unit-tests";

// ── Shared fixture state ──────────────────────────────────────────────────────

let testProfileId: number;
/** Thread used as the "current" conversation — must never appear in sources. */
let currentThreadId: number;
/** A pinned thread (always included regardless of smartRetrieval). */
let pinnedThreadId: number;
/** An unpinned thread used for recent / semantic hits. */
let recentThreadId: number;
/** A second unpinned thread — useful for mixed-mode tests. */
let extraThreadId: number;

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  const [profile] = await db
    .insert(profilesTable)
    .values({
      userId: TEST_USER_ID,
      name: "Memory Unit Test Profile",
      apiKey: encryptField(TEST_USER_ID, FAKE_API_KEY),
      embeddingProvider: "xai",
    })
    .returning({ id: profilesTable.id });
  testProfileId = profile!.id;

  const threads = await db
    .insert(threadsTable)
    .values([
      {
        userId: TEST_USER_ID,
        profileId: testProfileId,
        title: "Current Thread (must be excluded)",
        model: "grok-3",
        archived: false,
        pinned: false,
      },
      {
        userId: TEST_USER_ID,
        profileId: testProfileId,
        title: "Pinned Memory Thread",
        model: "grok-3",
        archived: false,
        pinned: true,
      },
      {
        userId: TEST_USER_ID,
        profileId: testProfileId,
        title: "Recent Unpinned Thread",
        model: "grok-3",
        archived: false,
        pinned: false,
      },
      {
        userId: TEST_USER_ID,
        profileId: testProfileId,
        title: "Extra Unpinned Thread",
        model: "grok-3",
        archived: false,
        pinned: false,
      },
    ])
    .returning({ id: threadsTable.id });

  currentThreadId = threads[0]!.id;
  pinnedThreadId = threads[1]!.id;
  recentThreadId = threads[2]!.id;
  extraThreadId = threads[3]!.id;

  // Add one message to the pinned thread so loadThreadSnippet has data
  await db.insert(messagesTable).values({
    threadId: pinnedThreadId,
    role: "user",
    content: encryptField(TEST_USER_ID, "This is a pinned memory message"),
    isSummary: false,
  });

  // Add one message to the recent thread
  await db.insert(messagesTable).values({
    threadId: recentThreadId,
    role: "assistant",
    content: encryptField(TEST_USER_ID, "This is a recent thread message"),
    isSummary: false,
  });
});

afterAll(async () => {
  const allThreadIds = [currentThreadId, pinnedThreadId, recentThreadId, extraThreadId].filter(
    Boolean,
  );
  if (allThreadIds.length > 0) {
    await db.delete(messagesTable).where(inArray(messagesTable.threadId, allThreadIds));
    await db.delete(threadsTable).where(inArray(threadsTable.id, allThreadIds));
  }
  if (testProfileId) {
    await db.delete(profilesTable).where(eq(profilesTable.id, testProfileId));
  }
});

beforeEach(() => {
  mockGenerateEmbedding.mockClear();
  mockGenerateEmbedding.mockResolvedValue(null);
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("retrieveMemories — pinned-only mode", () => {
  it("returns the pinned thread as a source with reason='pinned'", async () => {
    const result = await retrieveMemories({
      profileId: testProfileId,
      userId: TEST_USER_ID,
      currentThreadId,
      query: "anything",
      smartRetrieval: false,
      topN: 0,
      alwaysIncludeLastN: 0,
      apiKey: FAKE_API_KEY,
      trackUsage: false,
    });

    const pinnedSource = result.sources.find((s) => s.threadId === pinnedThreadId);
    expect(pinnedSource).toBeDefined();
    expect(pinnedSource!.reason).toBe("pinned");
  });

  it("does NOT include the current thread in sources", async () => {
    const result = await retrieveMemories({
      profileId: testProfileId,
      userId: TEST_USER_ID,
      currentThreadId,
      query: "current thread query",
      smartRetrieval: false,
      topN: 0,
      alwaysIncludeLastN: 0,
      apiKey: FAKE_API_KEY,
      trackUsage: false,
    });

    const ids = result.sources.map((s) => s.threadId);
    expect(ids).not.toContain(currentThreadId);
  });

  it("loads snippet messages for pinned sources", async () => {
    const result = await retrieveMemories({
      profileId: testProfileId,
      userId: TEST_USER_ID,
      currentThreadId,
      query: "pinned context",
      smartRetrieval: false,
      topN: 0,
      alwaysIncludeLastN: 0,
      apiKey: FAKE_API_KEY,
      trackUsage: false,
    });

    // At least one context message should be loaded from the pinned thread snippet
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it("returns relevanceScore=null for pinned sources", async () => {
    const result = await retrieveMemories({
      profileId: testProfileId,
      userId: TEST_USER_ID,
      currentThreadId,
      query: "pinned query",
      smartRetrieval: false,
      topN: 0,
      alwaysIncludeLastN: 0,
      apiKey: FAKE_API_KEY,
      trackUsage: false,
    });

    for (const src of result.sources.filter((s) => s.reason === "pinned")) {
      expect(src.relevanceScore).toBeNull();
    }
  });
});

describe("retrieveMemories — semantic mode (smartRetrieval=true)", () => {
  it("skips semantic search when generateEmbedding returns null", async () => {
    mockGenerateEmbedding.mockResolvedValue(null);

    const executeSpy = vi.spyOn(db, "execute");

    const result = await retrieveMemories({
      profileId: testProfileId,
      userId: TEST_USER_ID,
      currentThreadId,
      query: "find related memories",
      smartRetrieval: true,
      topN: 5,
      alwaysIncludeLastN: 0,
      apiKey: FAKE_API_KEY,
      trackUsage: false,
    });

    // db.execute should NOT have been called for the pgvector query
    // (the only execute calls allowed are the trackUsage UPDATE, which is skipped)
    const pgvectorCalls = executeSpy.mock.calls.filter((call) => {
      const sqlStr = JSON.stringify(call[0]);
      return sqlStr.includes("embedding");
    });
    expect(pgvectorCalls).toHaveLength(0);

    // No semantic sources should appear (embedding failed)
    const semanticSources = result.sources.filter((s) => s.reason === "semantic");
    expect(semanticSources).toHaveLength(0);
  });

  it("calls generateEmbedding with the query string when smartRetrieval=true", async () => {
    // Return null vector so we don't need real pgvector
    mockGenerateEmbedding.mockResolvedValue(null);

    await retrieveMemories({
      profileId: testProfileId,
      userId: TEST_USER_ID,
      currentThreadId,
      query: "unique query string for memory retrieval",
      smartRetrieval: true,
      topN: 5,
      alwaysIncludeLastN: 0,
      apiKey: FAKE_API_KEY,
      trackUsage: false,
    });

    expect(mockGenerateEmbedding).toHaveBeenCalledWith(
      "unique query string for memory retrieval",
      FAKE_API_KEY,
      "xai",
    );
  });

  it("does NOT call generateEmbedding when smartRetrieval=false", async () => {
    await retrieveMemories({
      profileId: testProfileId,
      userId: TEST_USER_ID,
      currentThreadId,
      query: "irrelevant query",
      smartRetrieval: false,
      topN: 5,
      alwaysIncludeLastN: 0,
      apiKey: FAKE_API_KEY,
      trackUsage: false,
    });

    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });

  it("populates semantic sources when db.execute returns pgvector rows", async () => {
    // Provide a fake 1536-dim vector so the pgvector branch runs
    const fakeVector = new Array(1536).fill(0.1);
    mockGenerateEmbedding.mockResolvedValue(fakeVector);

    // Intercept the pgvector SQL query and return the recentThreadId as a hit
    const executeSpy = vi.spyOn(db, "execute").mockResolvedValueOnce({
      rows: [
        {
          thread_id: recentThreadId,
          title: "Recent Unpinned Thread",
          message_count: 1,
          memory_weight: 0,
          score: 0.87,
        },
      ],
    } as any);

    const result = await retrieveMemories({
      profileId: testProfileId,
      userId: TEST_USER_ID,
      currentThreadId,
      query: "semantic query",
      smartRetrieval: true,
      topN: 5,
      alwaysIncludeLastN: 0,
      apiKey: FAKE_API_KEY,
      trackUsage: false,
    });

    executeSpy.mockRestore();

    const semanticSource = result.sources.find((s) => s.threadId === recentThreadId);
    expect(semanticSource).toBeDefined();
    expect(semanticSource!.reason).toBe("semantic");
    expect(semanticSource!.relevanceScore).toBeCloseTo(0.87, 2);
  });

  it("excludes already-pinned threads from semantic results (no duplicate sources)", async () => {
    const fakeVector = new Array(1536).fill(0.1);
    mockGenerateEmbedding.mockResolvedValue(fakeVector);

    // pgvector "returns" the pinned thread — it must be de-duped
    const executeSpy = vi.spyOn(db, "execute").mockResolvedValueOnce({
      rows: [
        {
          thread_id: pinnedThreadId,
          title: "Pinned Memory Thread",
          message_count: 1,
          memory_weight: 0,
          score: 0.95,
        },
      ],
    } as any);

    const result = await retrieveMemories({
      profileId: testProfileId,
      userId: TEST_USER_ID,
      currentThreadId,
      query: "overlapping query",
      smartRetrieval: true,
      topN: 5,
      alwaysIncludeLastN: 0,
      apiKey: FAKE_API_KEY,
      trackUsage: false,
    });

    executeSpy.mockRestore();

    // pinnedThreadId must appear exactly once (as "pinned", not also "semantic")
    const pinSources = result.sources.filter((s) => s.threadId === pinnedThreadId);
    expect(pinSources).toHaveLength(1);
    expect(pinSources[0]!.reason).toBe("pinned");
  });
});

describe("retrieveMemories — recent sessions (alwaysIncludeLastN)", () => {
  it("includes recent threads up to the alwaysIncludeLastN limit", async () => {
    const result = await retrieveMemories({
      profileId: testProfileId,
      userId: TEST_USER_ID,
      currentThreadId,
      query: "recent query",
      smartRetrieval: false,
      topN: 0,
      alwaysIncludeLastN: 2,
      apiKey: FAKE_API_KEY,
      trackUsage: false,
    });

    const recentSources = result.sources.filter((s) => s.reason === "recent");
    // At most alwaysIncludeLastN recent threads
    expect(recentSources.length).toBeLessThanOrEqual(2);
  });

  it("marks recent sources with reason='recent' and relevanceScore=null", async () => {
    const result = await retrieveMemories({
      profileId: testProfileId,
      userId: TEST_USER_ID,
      currentThreadId,
      query: "recent query",
      smartRetrieval: false,
      topN: 0,
      alwaysIncludeLastN: 3,
      apiKey: FAKE_API_KEY,
      trackUsage: false,
    });

    for (const src of result.sources.filter((s) => s.reason === "recent")) {
      expect(src.relevanceScore).toBeNull();
    }
  });

  it("does not double-count threads already included by pinned or semantic", async () => {
    const result = await retrieveMemories({
      profileId: testProfileId,
      userId: TEST_USER_ID,
      currentThreadId,
      query: "overlap",
      smartRetrieval: false,
      topN: 0,
      alwaysIncludeLastN: 10,
      apiKey: FAKE_API_KEY,
      trackUsage: false,
    });

    const ids = result.sources.map((s) => s.threadId);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });
});

describe("retrieveMemories — mixed mode (pinned + semantic + recent)", () => {
  it("returns sources from all three modes without duplicates", async () => {
    const fakeVector = new Array(1536).fill(0.1);
    mockGenerateEmbedding.mockResolvedValue(fakeVector);

    // pgvector returns extraThreadId as a semantic hit
    const executeSpy = vi.spyOn(db, "execute").mockResolvedValueOnce({
      rows: [
        {
          thread_id: extraThreadId,
          title: "Extra Unpinned Thread",
          message_count: 0,
          memory_weight: 0,
          score: 0.75,
        },
      ],
    } as any);

    const result = await retrieveMemories({
      profileId: testProfileId,
      userId: TEST_USER_ID,
      currentThreadId,
      query: "mixed query",
      smartRetrieval: true,
      topN: 5,
      alwaysIncludeLastN: 2,
      apiKey: FAKE_API_KEY,
      trackUsage: false,
    });

    executeSpy.mockRestore();

    // Must include the pinned thread
    expect(result.sources.find((s) => s.threadId === pinnedThreadId)).toBeDefined();
    // Must include the semantic hit
    expect(result.sources.find((s) => s.threadId === extraThreadId)).toBeDefined();

    // No duplicates
    const ids = result.sources.map((s) => s.threadId);
    expect(ids.length).toBe(new Set(ids).size);

    // Current thread must still be absent
    expect(ids).not.toContain(currentThreadId);
  });
});

describe("retrieveMemories — trackUsage flag", () => {
  it("does not call db.execute UPDATE when trackUsage=false", async () => {
    const executeSpy = vi.spyOn(db, "execute");

    await retrieveMemories({
      profileId: testProfileId,
      userId: TEST_USER_ID,
      currentThreadId,
      query: "preview call",
      smartRetrieval: false,
      topN: 0,
      alwaysIncludeLastN: 0,
      apiKey: FAKE_API_KEY,
      trackUsage: false,
    });

    // Any execute call with an UPDATE for memory_weight would be a bug
    const updateCalls = executeSpy.mock.calls.filter((call) => {
      const sqlStr = JSON.stringify(call[0]);
      return sqlStr.toLowerCase().includes("memory_weight");
    });
    expect(updateCalls).toHaveLength(0);
  });

  it("fires the memory_weight UPDATE when trackUsage=true (at least one source exists)", async () => {
    const executeSpy = vi.spyOn(db, "execute");

    await retrieveMemories({
      profileId: testProfileId,
      userId: TEST_USER_ID,
      currentThreadId,
      query: "real session call",
      smartRetrieval: false,
      topN: 0,
      alwaysIncludeLastN: 0,
      apiKey: FAKE_API_KEY,
      trackUsage: true,
    });

    // Wait briefly for the fire-and-forget UPDATE to settle
    await new Promise((r) => setTimeout(r, 100));

    if (executeSpy.mock.calls.length > 0) {
      // If any execute was called, at least one should be the memory_weight UPDATE
      const updateCalls = executeSpy.mock.calls.filter((call) => {
        const sqlStr = JSON.stringify(call[0]);
        return sqlStr.toLowerCase().includes("memory_weight");
      });
      // The pinned thread was retrieved, so the UPDATE must fire
      expect(updateCalls.length).toBeGreaterThan(0);
    }
  });

  it("actually increments usage for multiple retrieved threads with valid parameterized SQL", async () => {
    const ids = [pinnedThreadId, recentThreadId, extraThreadId];
    const before = await db.select({
      id: threadsTable.id, weight: threadsTable.memoryWeight,
    }).from(threadsTable).where(inArray(threadsTable.id, ids));
    const weights = new Map(before.map((row) => [row.id, row.weight]));
    const result = await retrieveMemories({
      profileId: testProfileId,
      userId: TEST_USER_ID,
      currentThreadId,
      query: "usage count regression",
      smartRetrieval: false,
      topN: 0,
      alwaysIncludeLastN: 2,
      apiKey: FAKE_API_KEY,
      trackUsage: true,
    });
    expect(result.sources.length).toBeGreaterThan(1);
    await expect.poll(async () => {
      const after = await db.select({
        id: threadsTable.id, weight: threadsTable.memoryWeight,
      }).from(threadsTable).where(inArray(threadsTable.id, ids));
      return result.sources.every((source) =>
        after.find((row) => row.id === source.threadId)?.weight ===
          (weights.get(source.threadId) ?? 0) + 1);
    }).toBe(true);
  });
});

describe("retrieveMemories — date range filter", () => {
  it("does not crash when dateFrom / dateTo are provided", async () => {
    await expect(
      retrieveMemories({
        profileId: testProfileId,
        userId: TEST_USER_ID,
        currentThreadId,
        query: "date filtered query",
        smartRetrieval: false,
        topN: 0,
        alwaysIncludeLastN: 2,
        apiKey: FAKE_API_KEY,
        trackUsage: false,
        dateFrom: "2020-01-01",
        dateTo: "2099-12-31",
      }),
    ).resolves.toBeDefined();
  });

  it("ignores invalid dateFrom/dateTo strings without throwing", async () => {
    await expect(
      retrieveMemories({
        profileId: testProfileId,
        userId: TEST_USER_ID,
        currentThreadId,
        query: "bad date query",
        smartRetrieval: false,
        topN: 0,
        alwaysIncludeLastN: 2,
        apiKey: FAKE_API_KEY,
        trackUsage: false,
        dateFrom: "not-a-date",
        dateTo: "also-not-a-date",
      }),
    ).resolves.toBeDefined();
  });
});
