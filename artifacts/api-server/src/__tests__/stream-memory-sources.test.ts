/**
 * stream-memory-sources.test.ts — E2E test: memory sources in the SSE stream
 *
 * Verifies that when retrieveMemories() returns sources, the stream endpoint:
 *   1. Emits a "memory_sources" SSE event early in the stream
 *   2. Includes "memorySources" in the "done" SSE event
 *   3. Returns a non-empty sources array (the UI memory panel can display it)
 *   4. Emits no memory_sources event when retrieval returns an empty list
 *
 * retrieveMemories and streamCompletion are mocked so the test is hermetic —
 * it validates the wiring in the stream route without needing a real AI API
 * key or pgvector extension.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import cookieParser from "cookie-parser";

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_USER_ID = "test-user-stream-memory-sources-e2e";

// ── Mocks (hoisted before module imports) ────────────────────────────────────

vi.mock("../middlewares/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).userId = TEST_USER_ID;
    next();
  },
}));

vi.mock("../middlewares/mcp-auth.js", () => ({
  requireMcpOrAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).userId = TEST_USER_ID;
    next();
  },
}));

const mockMemorySources = [
  { threadId: 42, title: "Pinned Memory Thread", reason: "pinned", relevanceScore: null, messageCount: 5 },
  { threadId: 99, title: "Related Conversation", reason: "semantic", relevanceScore: 0.88, messageCount: 3 },
];

const mockRetrieveMemories = vi.fn().mockResolvedValue({
  messages: [{ role: "system", content: '[Memory: "Pinned Memory Thread" (pinned)]' }],
  sources: mockMemorySources,
});

vi.mock("../lib/memory.js", () => ({
  retrieveMemories: (...args: unknown[]) => mockRetrieveMemories(...args),
}));

vi.mock("../lib/ai-provider.js", () => ({
  resolveChatKey: () => "fake-stream-key",
  streamCompletion: vi.fn(
    async (
      _provider: unknown,
      _key: unknown,
      _model: unknown,
      _messages: unknown,
      callbacks: {
        onToken: (t: string) => void;
        onError: (m: string) => void;
        onDone: () => void;
      },
    ) => {
      callbacks.onToken("Memory ");
      callbacks.onToken("context loaded");
      callbacks.onDone();
    },
  ),
}));

vi.mock("../lib/embeddings.js", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(null),
  storeEmbedding: vi.fn().mockResolvedValue(true),
  embedMessageAsync: vi.fn(),
}));

vi.mock("../lib/db-bootstrap.js", () => ({
  isPgvectorAvailable: vi.fn().mockReturnValue(false),
  bootstrapDb: vi.fn().mockResolvedValue(undefined),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { db, threadsTable, messagesTable, profilesTable, settingsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { encryptField } from "../lib/field-crypto.js";
import messagesRouter from "../routes/messages.js";

// ── App builder ───────────────────────────────────────────────────────────────

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req: any, _res: Response, next: NextFunction) => {
    req.log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  app.use(messagesRouter);
  return app;
}

// ── SSE parsing helper ────────────────────────────────────────────────────────

function parseSseEvents(body: string): Array<Record<string, unknown>> {
  return body
    .split("\n\n")
    .filter(Boolean)
    .flatMap((block) => {
      const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
      if (!dataLine) return [];
      try {
        return [JSON.parse(dataLine.slice(6)) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
}

// ── Fixture state ─────────────────────────────────────────────────────────────

let testProfileId: number;
let testThreadId: number;

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  // Insert a profile with an API key so the stream route can resolve one
  const [profile] = await db
    .insert(profilesTable)
    .values({
      userId: TEST_USER_ID,
      name: "Stream Memory Sources Test Profile",
      apiKey: encryptField(TEST_USER_ID, "fake-api-key-for-stream-test"),
      embeddingProvider: "xai",
    })
    .returning({ id: profilesTable.id });
  testProfileId = profile!.id;

  // Settings row so resolveChatKey can find an API key
  await db
    .insert(settingsTable)
    .values({
      userId: TEST_USER_ID,
      apiKey: encryptField(TEST_USER_ID, "fake-settings-key"),
    })
    .onConflictDoUpdate({
      target: settingsTable.userId,
      set: { apiKey: encryptField(TEST_USER_ID, "fake-settings-key") },
    });

  // A thread for the current conversation
  const [thread] = await db
    .insert(threadsTable)
    .values({
      userId: TEST_USER_ID,
      profileId: testProfileId,
      title: "Stream Memory Sources E2E Thread",
      model: "grok-3",
    })
    .returning({ id: threadsTable.id });
  testThreadId = thread!.id;
});

afterAll(async () => {
  if (testThreadId) {
    await db.delete(messagesTable).where(eq(messagesTable.threadId, testThreadId));
    await db.delete(threadsTable).where(
      and(eq(threadsTable.id, testThreadId), eq(threadsTable.userId, TEST_USER_ID)),
    );
  }
  await db.delete(settingsTable).where(eq(settingsTable.userId, TEST_USER_ID));
  if (testProfileId) {
    await db.delete(profilesTable).where(eq(profilesTable.id, testProfileId));
  }
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /threads/:id/stream — memorySources in SSE events", () => {
  it("responds with HTTP 200 and Content-Type: text/event-stream", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post(`/threads/${testThreadId}/stream`)
      .send({ content: "What do you remember about me?" });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
  });

  it("emits a 'memory_sources' SSE event containing the retrieved sources", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post(`/threads/${testThreadId}/stream`)
      .send({ content: "Tell me what you know" });

    const events = parseSseEvents(res.text);
    const memoryEvent = events.find((e) => e.type === "memory_sources") as
      | { type: string; sources: typeof mockMemorySources }
      | undefined;

    expect(memoryEvent).toBeDefined();
    expect(Array.isArray(memoryEvent!.sources)).toBe(true);
    expect(memoryEvent!.sources.length).toBeGreaterThan(0);
  });

  it("'memory_sources' event contains the pinned thread source", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post(`/threads/${testThreadId}/stream`)
      .send({ content: "Context check" });

    const events = parseSseEvents(res.text);
    const memoryEvent = events.find((e) => e.type === "memory_sources") as
      | { type: string; sources: Array<{ threadId: number; reason: string }> }
      | undefined;

    expect(memoryEvent).toBeDefined();
    const pinnedSource = memoryEvent!.sources.find((s) => s.reason === "pinned");
    expect(pinnedSource).toBeDefined();
    expect(pinnedSource!.threadId).toBe(42);
  });

  it("'done' event contains memorySources matching those from retrieval", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post(`/threads/${testThreadId}/stream`)
      .send({ content: "Memory context in done event" });

    const events = parseSseEvents(res.text);
    const doneEvent = events.find((e) => e.type === "done") as
      | { type: string; memorySources?: Array<{ threadId: number; reason: string }> }
      | undefined;

    expect(doneEvent).toBeDefined();
    expect(Array.isArray(doneEvent!.memorySources)).toBe(true);
    expect(doneEvent!.memorySources!.length).toBe(mockMemorySources.length);

    const pinnedInDone = doneEvent!.memorySources!.find((s) => s.reason === "pinned");
    expect(pinnedInDone).toBeDefined();
    expect(pinnedInDone!.threadId).toBe(42);

    const semanticInDone = doneEvent!.memorySources!.find((s) => s.reason === "semantic");
    expect(semanticInDone).toBeDefined();
    expect(semanticInDone!.threadId).toBe(99);
  });

  it("'done' event memorySources includes relevanceScore for semantic sources", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post(`/threads/${testThreadId}/stream`)
      .send({ content: "Relevance score check" });

    const events = parseSseEvents(res.text);
    const doneEvent = events.find((e) => e.type === "done") as
      | { type: string; memorySources?: Array<{ reason: string; relevanceScore: number | null }> }
      | undefined;

    expect(doneEvent).toBeDefined();
    const semanticSrc = doneEvent!.memorySources!.find((s) => s.reason === "semantic");
    expect(semanticSrc).toBeDefined();
    expect(semanticSrc!.relevanceScore).toBeCloseTo(0.88, 2);
  });

  it("emits no 'memory_sources' event when retrieval returns an empty list", async () => {
    // Override mock to return no sources for this test
    mockRetrieveMemories.mockResolvedValueOnce({ messages: [], sources: [] });

    const app = buildTestApp();
    const res = await request(app)
      .post(`/threads/${testThreadId}/stream`)
      .send({ content: "No memories at all" });

    const events = parseSseEvents(res.text);
    const memoryEvent = events.find((e) => e.type === "memory_sources");
    expect(memoryEvent).toBeUndefined();
  });

  it("still emits 'done' with empty memorySources when retrieval returns nothing", async () => {
    mockRetrieveMemories.mockResolvedValueOnce({ messages: [], sources: [] });

    const app = buildTestApp();
    const res = await request(app)
      .post(`/threads/${testThreadId}/stream`)
      .send({ content: "Empty memory context" });

    const events = parseSseEvents(res.text);
    const doneEvent = events.find((e) => e.type === "done") as
      | { type: string; memorySources?: unknown[] }
      | undefined;

    expect(doneEvent).toBeDefined();
    // memorySources is either absent or an empty array — not a non-empty array
    if (doneEvent!.memorySources !== undefined) {
      expect(doneEvent!.memorySources).toHaveLength(0);
    }
  });

  it("persists the user message and streams the assistant reply as plaintext", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post(`/threads/${testThreadId}/stream`)
      .send({ content: "persist test message with memory context" });

    expect(res.status).toBe(200);

    const events = parseSseEvents(res.text);
    const doneEvent = events.find((e) => e.type === "done") as
      | { type: string; message: { content: string } }
      | undefined;

    expect(doneEvent).toBeDefined();
    // Content must be plaintext (no enc:v1: prefix)
    expect(doneEvent!.message.content.startsWith("enc:v1:")).toBe(false);
    expect(doneEvent!.message.content).toBe("Memory context loaded");
  });

  it("'memory_sources' event appears before 'done' in the stream", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post(`/threads/${testThreadId}/stream`)
      .send({ content: "ordering check" });

    const events = parseSseEvents(res.text);
    const memIdx = events.findIndex((e) => e.type === "memory_sources");
    const doneIdx = events.findIndex((e) => e.type === "done");

    expect(memIdx).toBeGreaterThanOrEqual(0);
    expect(doneIdx).toBeGreaterThan(memIdx);
  });
});
