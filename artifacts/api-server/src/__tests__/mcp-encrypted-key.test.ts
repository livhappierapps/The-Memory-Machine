/**
 * Verifies that save_memory decrypts the profile API key before passing it
 * to generateEmbedding — and that the embedding is stored synchronously
 * (not fire-and-forget) so it is present immediately after the HTTP response.
 *
 * API keys are stored as AES-256-GCM ciphertext (enc:v1:...) keyed per-user.
 * Passing the raw ciphertext to the embedding provider would cause a 401 and
 * silently skip the embedding.  This test catches that regression.
 *
 * Mocks:
 *   - generateEmbedding → inspectable vi.fn() so we can assert the key arg
 *   - storeEmbedding    → the real implementation (writes to the test DB)
 *     so the "immediately present" assertion is authoritative.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ── Mocks — hoisted before module resolution ──────────────────────────────────

// Intercept generateEmbedding so we can assert which key was used.
// storeEmbedding is intentionally NOT mocked — we need the real DB write.
vi.mock("../lib/embeddings.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/embeddings.js")>();
  const unitValue = 1 / Math.sqrt(1536);
  const mockVector: number[] = Array.from({ length: 1536 }, () => unitValue);
  return {
    ...original, // real storeEmbedding
    generateEmbedding: vi.fn().mockResolvedValue(mockVector),
    embedMessageAsync: original.embedMessageAsync,
  };
});

vi.mock("../middlewares/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).userId = TEST_USER_ID;
    next();
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { db, settingsTable, threadsTable, messagesTable, profilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import mcpRouter from "../routes/mcp.js";
import { sha256Hex, encryptField } from "../lib/field-crypto.js";
import { generateEmbedding } from "../lib/embeddings.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_USER_ID = "test-user-mcp-encrypted-key";
const TEST_MCP_TOKEN = "mcp-encrypted-key-test-token-vitest";
const PLAINTEXT_API_KEY = "plaintext-fake-api-key-for-vitest";

const MEMORY_TITLE = "vitest-encrypted-key-unique-alpha9q";
const MEMORY_CONTENT = "Encrypted key decryption test content.";

// ── App builder ───────────────────────────────────────────────────────────────

function buildMcpApp() {
  const app = express();
  app.use(express.json());
  app.use((_req: any, _res: Response, next: NextFunction) => {
    (_req as any).log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  app.use(mcpRouter);
  return app;
}

function mcpCallBody(toolName: string, args: Record<string, unknown>, id = 1) {
  return {
    jsonrpc: "2.0",
    method: "tools/call",
    params: { name: toolName, arguments: args },
    id,
  };
}

function parseMcpText(body: string, contentType: string): string {
  if (contentType.includes("text/event-stream")) {
    for (const line of body.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          const parsed = JSON.parse(line.slice(6)) as {
            result?: { content: Array<{ text: string }> };
          };
          return parsed.result?.content[0]?.text ?? "";
        } catch {
          /* skip */
        }
      }
    }
    return "";
  }
  try {
    const parsed = JSON.parse(body) as { result?: { content: Array<{ text: string }> } };
    return parsed.result?.content[0]?.text ?? "";
  } catch {
    return "";
  }
}

// ── Shared state ──────────────────────────────────────────────────────────────

let testProfileId: number;
let savedThreadId: number | null = null;

// ── Fixtures ──────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Store the API key encrypted at rest — exactly as the app does when a user
  // saves a profile with an API key.
  const encryptedKey = encryptField(TEST_USER_ID, PLAINTEXT_API_KEY);

  const [profile] = await db
    .insert(profilesTable)
    .values({
      userId: TEST_USER_ID,
      name: "Encrypted Key Test Profile",
      emoji: "🔐",
      color: "#222222",
      apiKey: encryptedKey,
    })
    .returning({ id: profilesTable.id });

  testProfileId = profile!.id;

  const tokenHash = sha256Hex(TEST_MCP_TOKEN);
  await db
    .insert(settingsTable)
    .values({ userId: TEST_USER_ID, mcpToken: TEST_MCP_TOKEN, mcpTokenHash: tokenHash })
    .onConflictDoUpdate({
      target: settingsTable.userId,
      set: { mcpToken: TEST_MCP_TOKEN, mcpTokenHash: tokenHash },
    });
});

afterAll(async () => {
  if (savedThreadId) {
    await db.delete(messagesTable).where(eq(messagesTable.threadId, savedThreadId));
    await db.delete(threadsTable).where(eq(threadsTable.id, savedThreadId));
  }
  const stray = await db
    .select({ id: threadsTable.id })
    .from(threadsTable)
    .where(eq(threadsTable.userId, TEST_USER_ID));
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

describe("save_memory — encrypted API key handling", () => {
  it("save_memory returns HTTP 200 and a thread ID when the API key is encrypted at rest", async () => {
    const res = await request(buildMcpApp())
      .post("/mcp")
      .set("Authorization", `Bearer ${TEST_MCP_TOKEN}`)
      .set("Accept", "application/json, text/event-stream")
      .send(mcpCallBody("save_memory", { title: MEMORY_TITLE, content: MEMORY_CONTENT, pin: true }));

    expect(res.status).toBe(200);

    const text = parseMcpText(res.text, res.headers["content-type"] ?? "");
    const idMatch = text.match(/ID:\s*#?(\d+)/);
    expect(idMatch, "Response must contain the thread ID").not.toBeNull();
    savedThreadId = parseInt(idMatch![1]!, 10);
    expect(savedThreadId).toBeGreaterThan(0);
  });

  it("generateEmbedding is called with the DECRYPTED plaintext API key (not the enc:v1: ciphertext)", () => {
    // This is the critical security + correctness assertion:
    // if the raw ciphertext were passed to the provider, the request would 401.
    const mockFn = generateEmbedding as ReturnType<typeof vi.fn>;
    expect(mockFn).toHaveBeenCalled();

    const firstCall = mockFn.mock.calls[0];
    // arg[1] is the apiKey passed to generateEmbedding
    const keyArgUsed = firstCall?.[1] as string;

    expect(
      keyArgUsed,
      "generateEmbedding should be called with the plaintext key, not the enc:v1: ciphertext",
    ).toBe(PLAINTEXT_API_KEY);

    expect(
      keyArgUsed,
      "The key argument must not start with enc:v1: — that is the raw ciphertext",
    ).not.toMatch(/^enc:v1:/);
  });

  it("embedding row is in the DB immediately after save_memory returns (synchronous — not fire-and-forget)", async () => {
    expect(savedThreadId, "save_memory must succeed before this test runs").not.toBeNull();

    // No polling — since save_memory now awaits storeEmbedding, the row MUST
    // exist before the HTTP response is returned to the caller.
    type Row = { cnt: string };
    const result = await db.execute<Row>(
      sql`SELECT COUNT(*)::text AS cnt FROM embeddings WHERE thread_id = ${savedThreadId}`,
    );
    const count = parseInt(result.rows[0]?.cnt ?? "0", 10);

    expect(
      count,
      `Expected an embedding row for thread ${savedThreadId} immediately after save_memory — ` +
        "if zero, the embedding is still fire-and-forget and not synchronously stored",
    ).toBeGreaterThan(0);
  });
});
