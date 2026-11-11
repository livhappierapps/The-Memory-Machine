/**
 * Integration tests for MCP bearer-token authentication on GET /messages/recent.
 *
 * These tests use the REAL requireMcpOrAuth middleware (not mocked) to verify:
 *   - A valid MCP bearer token resolves to the correct user and returns 200
 *   - An invalid / unknown token is rejected with 401
 *   - A request with no Authorization header is rejected with 401
 *
 * The Clerk fallback path is covered by the existing messages-api.test.ts suite
 * which mocks requireAuth to inject a deterministic userId.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

// ── Mocks (hoisted before any imports that resolve them) ─────────────────────

// Do NOT mock mcp-auth.js — we need the real implementation.
// Mock embeddings to avoid real API calls.
vi.mock("../lib/embeddings.js", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(null),
  storeEmbedding: vi.fn().mockResolvedValue(undefined),
  embedMessageAsync: vi.fn(),
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import { db, settingsTable, threadsTable, messagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import messagesRouter from "../routes/messages.js";
import { sha256Hex, encryptField } from "../lib/field-crypto.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_USER_ID = "test-user-mcp-auth-messages-integration";
const TEST_MCP_TOKEN = "mcp-auth-messages-test-token-vitest-only";
const INVALID_TOKEN = "mcp-bad-token-does-not-exist";

// ── App factory ───────────────────────────────────────────────────────────────

function buildApp() {
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

let testThreadId: number;

beforeAll(async () => {
  // Insert a settings row so getUserIdByMcpToken can resolve the test token.
  const tokenHash = sha256Hex(TEST_MCP_TOKEN);
  await db
    .insert(settingsTable)
    .values({ userId: TEST_USER_ID, mcpToken: null, mcpTokenHash: tokenHash })
    .onConflictDoUpdate({
      target: settingsTable.userId,
      set: { mcpTokenHash: tokenHash },
    });

  // Insert a thread and a message so the endpoint can return real data.
  const [thread] = await db
    .insert(threadsTable)
    .values({
      userId: TEST_USER_ID,
      title: "MCP auth test thread (safe to delete)",
      model: "grok-4",
    })
    .returning({ id: threadsTable.id });

  testThreadId = thread!.id;

  await db.insert(messagesTable).values({
    threadId: testThreadId,
    role: "user",
    content: encryptField(TEST_USER_ID, "MCP auth test message"),
    isSummary: false,
  });
});

afterAll(async () => {
  if (testThreadId) {
    await db.delete(messagesTable).where(eq(messagesTable.threadId, testThreadId));
    await db.delete(threadsTable).where(eq(threadsTable.id, testThreadId));
  }
  await db.delete(settingsTable).where(eq(settingsTable.userId, TEST_USER_ID));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /messages/recent — MCP bearer-token authentication", () => {
  it("returns 200 and an array when a valid MCP token is supplied", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/messages/recent")
      .set("Authorization", `Bearer ${TEST_MCP_TOKEN}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("returns the test message decrypted (no enc:v1: prefix) via MCP token", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/messages/recent?limit=200")
      .set("Authorization", `Bearer ${TEST_MCP_TOKEN}`);

    expect(res.status).toBe(200);
    for (const msg of res.body as Array<{ content: string }>) {
      expect(msg.content).not.toMatch(/^enc:v1:/);
    }
  });

  it("returns 401 when an unknown bearer token is supplied", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/messages/recent")
      .set("Authorization", `Bearer ${INVALID_TOKEN}`);

    expect(res.status).toBe(401);
  });

  it("returns 401 when no Authorization header is supplied", async () => {
    const app = buildApp();
    const res = await request(app).get("/messages/recent");

    expect(res.status).toBe(401);
  });
});
