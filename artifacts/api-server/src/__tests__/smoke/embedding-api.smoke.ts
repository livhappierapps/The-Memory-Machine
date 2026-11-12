/**
 * MCP save_memory end-to-end smoke test — real embedding API.
 *
 * Exercises the FULL path:
 *   MCP bearer-token auth → profile key resolution (decrypt) →
 *   save_memory (thread + message created) →
 *   generateEmbedding (real API call) → storeEmbedding (DB write) →
 *   search_memories (vector similarity search)
 *
 * This test is intentionally excluded from the normal unit-test suite.
 * Run it manually or in CI with a real key:
 *
 *   EMBEDDING_API_KEY=sk-... pnpm --filter @workspace/api-server test:smoke
 *
 * Optionally set EMBEDDING_PROVIDER=openai to test the OpenAI path
 * (defaults to "xai"). When EMBEDDING_API_KEY is absent every test is
 * explicitly skipped (reported as "skipped", not "passed") so a no-key
 * run is never mistaken for a successful live verification.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Response, type NextFunction } from "express";
import request from "supertest";
import { db, settingsTable, threadsTable, messagesTable, profilesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import mcpRouter from "../../routes/mcp.js";
import { sha256Hex, encryptField } from "../../lib/field-crypto.js";

// ── Environment ───────────────────────────────────────────────────────────────

const API_KEY = process.env.EMBEDDING_API_KEY ?? "";
const PROVIDER = (process.env.EMBEDDING_PROVIDER ?? "xai") as "xai" | "openai";
const EXPECTED_DIM = 1536;

const noKey = !API_KEY;

// ── Test identity ─────────────────────────────────────────────────────────────

const TEST_USER_ID = "smoke-mcp-embedding-e2e-user";
const TEST_MCP_TOKEN = "smoke-mcp-embedding-e2e-token";

// Unique enough to avoid collisions with the regular test suite.
const MEMORY_TITLE = "vitest-smoke-embedding-e2e-unique-z9q7";
const MEMORY_CONTENT =
  "End-to-end smoke verification: this note must be stored with a real embedding " +
  "vector and returned by semantic similarity search with a score above zero.";

// Polling: wait up to 10 s in 200 ms steps for the embedding row.
// save_memory now awaits the embedding synchronously, but give it some slack.
const POLL_INTERVAL_MS = 200;
const POLL_TIMEOUT_MS = 10_000;

// ── App factory (no mocks) ────────────────────────────────────────────────────

function buildMcpApp() {
  const app = express();
  app.use(express.json());
  app.use((_req: any, _res: Response, next: NextFunction) => {
    // Silence pino request logging in tests
    (_req as any).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
      debug: () => {},
    };
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
): {
  id: number;
  result?: { content: Array<{ type: string; text: string }> };
  error?: unknown;
} | null {
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

async function pollForEmbedding(threadId: number): Promise<number> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    type Row = { cnt: string };
    const result = await db.execute<Row>(
      sql`SELECT COUNT(*)::text AS cnt FROM embeddings WHERE thread_id = ${threadId}`,
    );
    const count = parseInt(result.rows[0]?.cnt ?? "0", 10);
    if (count > 0) return count;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return 0;
}

// ── Shared state ──────────────────────────────────────────────────────────────

let testProfileId: number;
let savedThreadId: number | null = null;

// ── Fixtures ──────────────────────────────────────────────────────────────────

beforeAll(async () => {
  if (noKey) return; // skip fixture setup entirely when no key

  // Encrypt the real API key the same way the profiles route does.
  // The MCP route calls decryptField() on the stored value, so we must store
  // it encrypted — storing plaintext would cause a decryption failure.
  const encryptedKey = encryptField(TEST_USER_ID, API_KEY);

  const profileValues =
    PROVIDER === "openai"
      ? {
          userId: TEST_USER_ID,
          name: "Smoke Test Profile (OpenAI)",
          emoji: "🔬",
          color: "#222222",
          embeddingProvider: "openai" as const,
          openAiApiKey: encryptedKey,
        }
      : {
          userId: TEST_USER_ID,
          name: "Smoke Test Profile (xAI)",
          emoji: "🔬",
          color: "#222222",
          embeddingProvider: "xai" as const,
          apiKey: encryptedKey,
        };

  const [profile] = await db
    .insert(profilesTable)
    .values(profileValues)
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
  if (noKey) return;

  if (savedThreadId) {
    await db.delete(messagesTable).where(eq(messagesTable.threadId, savedThreadId));
    await db.delete(threadsTable).where(eq(threadsTable.id, savedThreadId));
  }

  // Catch stray threads from failed previous runs
  const stray = await db
    .select({ id: threadsTable.id })
    .from(threadsTable)
    .where(
      and(eq(threadsTable.userId, TEST_USER_ID), eq(threadsTable.title, MEMORY_TITLE)),
    );
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

describe(
  `MCP save_memory smoke test — real ${PROVIDER} embedding API (${noKey ? "SKIPPED — no EMBEDDING_API_KEY" : "LIVE"})`,
  () => {
    it.skipIf(noKey)(
      "save_memory returns HTTP 200 and a thread ID (MCP auth + DB write)",
      async () => {
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

        const parsed = parseMcpResponse(
          res.text,
          res.headers["content-type"] ?? "",
        );
        expect(parsed, "MCP response could not be parsed").not.toBeNull();
        expect(parsed!.error, "MCP returned an error result").toBeUndefined();
        expect(parsed!.result).toBeDefined();

        const responseText = parsed!.result!.content[0]?.text ?? "";

        // Confirm the response doesn't contain the embedding-failure warning.
        // If the real API call failed, save_memory still succeeds but warns.
        expect(
          responseText,
          "save_memory reported an embedding failure — the real API call likely failed (wrong key, model, or dimension)",
        ).not.toContain("embedding could not be persisted");

        const idMatch = responseText.match(/ID:\s*#?(\d+)/);
        expect(
          idMatch,
          "Response should contain the thread ID (e.g. 'ID: #42')",
        ).not.toBeNull();

        savedThreadId = parseInt(idMatch![1]!, 10);
        expect(savedThreadId).toBeGreaterThan(0);

        console.log(
          `  ✓ save_memory created thread #${savedThreadId} (provider: ${PROVIDER})`,
        );
      },
    );

    it.skipIf(noKey)(
      `embedding row for the saved thread exists in the DB with length ${EXPECTED_DIM} (real API call persisted)`,
      async () => {
        expect(
          savedThreadId,
          "save_memory must succeed first — run tests in order",
        ).not.toBeNull();

        // Embedding is written synchronously inside save_memory, so it should
        // already be present.  Poll briefly to absorb any async lag.
        const count = await pollForEmbedding(savedThreadId!);
        expect(
          count,
          `No embedding row found for thread #${savedThreadId} after ${POLL_TIMEOUT_MS} ms. ` +
            "The real API call may have returned null (wrong key, model name mismatch, or rate limit).",
        ).toBeGreaterThan(0);

        // Fetch the raw vector shape and L2 norm.
        // pgvector's <#> operator is NEGATIVE inner product, so:
        //   embedding <#> embedding = -‖embedding‖²
        //   SQRT(-(embedding <#> embedding)) = ‖embedding‖
        type EmbRow = { dim: string; norm: string };
        const result = await db.execute<EmbRow>(
          sql`
            SELECT
              vector_dims(embedding)::text                        AS dim,
              SQRT(-(embedding <#> embedding))::text              AS norm
            FROM embeddings
            WHERE thread_id = ${savedThreadId!}
            LIMIT 1
          `,
        );

        const row = result.rows[0];
        expect(row, "Embedding row missing from DB").toBeDefined();

        const dim = parseInt(row!.dim, 10);
        expect(
          dim,
          `Expected embedding dimension ${EXPECTED_DIM}, got ${dim}. ` +
            "This indicates a model or provider mismatch.",
        ).toBe(EXPECTED_DIM);

        // L2 norm must be a positive finite number.
        const norm = parseFloat(row!.norm);
        expect(
          Number.isFinite(norm) && norm > 0,
          `Vector L2 norm is ${norm} — expected a positive finite number (non-zero embedding)`,
        ).toBe(true);

        console.log(
          `  ✓ Embedding row: dim=${dim}, ‖v‖≈${norm.toFixed(6)} (provider: ${PROVIDER})`,
        );
      },
    );

    it.skipIf(noKey)(
      "search_memories returns the saved note with similarity > 0 (semantic search path confirmed)",
      async () => {
        expect(
          savedThreadId,
          "save_memory must succeed first — run tests in order",
        ).not.toBeNull();

        const res = await request(buildMcpApp())
          .post("/mcp")
          .set("Authorization", `Bearer ${TEST_MCP_TOKEN}`)
          .set("Accept", "application/json, text/event-stream")
          .send(
            mcpCallBody(
              "search_memories",
              { query: "end-to-end smoke verification embedding note", limit: 5 },
              2,
            ),
          );

        expect(res.status).toBe(200);

        const parsed = parseMcpResponse(
          res.text,
          res.headers["content-type"] ?? "",
        );
        expect(parsed, "MCP response could not be parsed").not.toBeNull();
        expect(parsed!.error, "MCP returned an error result").toBeUndefined();

        const responseText = parsed!.result!.content[0]?.text ?? "";

        expect(
          responseText,
          `search_memories should include thread #${savedThreadId} — it was just created`,
        ).toContain(`#${savedThreadId}`);

        const simMatch = responseText.match(/similarity:\s*(\d+)%/);
        expect(
          simMatch,
          "search_memories response should contain a 'similarity: N%' value. " +
            "If missing, the semantic path was not taken (the embedding may not have been stored).",
        ).not.toBeNull();

        const similarityPct = parseInt(simMatch![1]!, 10);
        expect(
          similarityPct,
          `Similarity score is ${similarityPct}% — expected > 0. ` +
            "A score of 0 means the keyword-only fallback was used, not the vector path.",
        ).toBeGreaterThan(0);

        console.log(
          `  ✓ search_memories returned thread #${savedThreadId} with similarity: ${similarityPct}% (provider: ${PROVIDER})`,
        );
      },
    );
  },
);
