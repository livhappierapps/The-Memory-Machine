/**
 * Verifies that reembedOrphanedMessages() — the startup sweep in db-bootstrap.ts —
 * re-embeds messages that were saved (e.g. via save_memory) but whose embedding
 * row was never written, e.g. because the server restarted mid-flight.
 *
 * Also verifies that the sweep correctly decrypts the profile's API key before
 * passing it to the embedding API (keys are stored as enc:v1: ciphertext).
 *
 * Mocks:
 *   - generateEmbeddingResult → inspectable vi.fn() that returns a unit vector so
 *     we can assert the decrypted key was used.
 *   - storeEmbedding    → real implementation (writes to DB) so the assertion
 *     that the row exists afterward is authoritative.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../lib/embeddings.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/embeddings.js")>();
  const unitValue = 1 / Math.sqrt(1536);
  const mockVector: number[] = Array.from({ length: 1536 }, () => unitValue);
  return {
    ...original, // real storeEmbedding so we can verify the DB write
    generateEmbeddingResult: vi.fn().mockResolvedValue({ vector: mockVector, permanentFailure: false }),
  };
});

// ── Imports ───────────────────────────────────────────────────────────────────

import { db, threadsTable, messagesTable, profilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { encryptField } from "../lib/field-crypto.js";
import { generateEmbeddingResult } from "../lib/embeddings.js";
import { reembedOrphanedMessages } from "../lib/db-bootstrap.js";
import { logger } from "../lib/logger.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_USER_ID = "test-user-db-bootstrap-sweep";
const PLAINTEXT_API_KEY = "sweep-test-fake-api-key";

// ── Shared state ──────────────────────────────────────────────────────────────

let testProfileId: number;
let testThreadId: number;
let testMessageId: number;

// ── Fixtures ──────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Profile with an encrypted API key (exactly as it is stored in production)
  const encryptedKey = encryptField(TEST_USER_ID, PLAINTEXT_API_KEY);
  const [profile] = await db
    .insert(profilesTable)
    .values({
      userId: TEST_USER_ID,
      name: "Bootstrap Sweep Test Profile",
      emoji: "🔄",
      color: "#333333",
      apiKey: encryptedKey,
    })
    .returning({ id: profilesTable.id });
  testProfileId = profile!.id;

  // Thread owned by the test user, linked to the test profile
  const [thread] = await db
    .insert(threadsTable)
    .values({
      userId: TEST_USER_ID,
      profileId: testProfileId,
      title: "vitest-sweep-orphan-thread",
      pinned: false,
      archived: false,
      model: "grok-3",
      messageCount: 1,
    })
    .returning({ id: threadsTable.id });
  testThreadId = thread!.id;

  // Message content is encrypted (just like real messages)
  const encryptedContent = encryptField(TEST_USER_ID, "Orphaned message content for sweep test.");
  const [message] = await db
    .insert(messagesTable)
    .values({
      threadId: testThreadId,
      role: "user",
      content: encryptedContent,
      isSummary: false,
    })
    .returning({ id: messagesTable.id });
  testMessageId = message!.id;

  // Intentionally do NOT insert a row in the embeddings table — this simulates
  // a message that lost its embedding due to a server restart.
});

afterAll(async () => {
  // Delete in dependency order (embeddings cascade from messages/threads)
  if (testMessageId) {
    await db.delete(messagesTable).where(eq(messagesTable.id, testMessageId));
  }
  if (testThreadId) {
    await db.delete(threadsTable).where(eq(threadsTable.id, testThreadId));
  }
  if (testProfileId) {
    await db.delete(profilesTable).where(eq(profilesTable.id, testProfileId));
  }
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("reembedOrphanedMessages — startup sweep", () => {
  it("calls generateEmbedding with the DECRYPTED API key (not raw enc:v1: ciphertext)", async () => {
    // Reset the spy so earlier test files don't pollute the call log.
    vi.mocked(generateEmbeddingResult).mockClear();

    await reembedOrphanedMessages();

    const mockFn = vi.mocked(generateEmbeddingResult);
    // The sweep should have called generateEmbedding at least once for our orphaned message.
    const callsForOurMessage = mockFn.mock.calls.filter((args) => {
      const key = args[1] as string;
      return key === PLAINTEXT_API_KEY;
    });

    expect(
      callsForOurMessage.length,
      "generateEmbedding should be called with the plaintext API key for the orphaned message — " +
        "if zero, the sweep is passing the raw enc:v1: ciphertext to the embedding provider",
    ).toBeGreaterThan(0);

    // Confirm the ciphertext was NOT passed through raw
    const allKeys = mockFn.mock.calls.map((args) => args[1] as string);
    const rawCiphertextCalls = allKeys.filter((k) => k?.startsWith("enc:v1:"));
    expect(
      rawCiphertextCalls.length,
      "No generateEmbedding call should use an enc:v1: ciphertext as the API key",
    ).toBe(0);
  });

  it("embedding row is written to the DB for the orphaned message after the sweep", async () => {
    type Row = { cnt: string };
    const result = await db.execute<Row>(
      sql`SELECT COUNT(*)::text AS cnt FROM embeddings WHERE message_id = ${testMessageId}`,
    );
    const count = parseInt(result.rows[0]?.cnt ?? "0", 10);

    expect(
      count,
      `Expected an embeddings row for message ${testMessageId} after reembedOrphanedMessages() — ` +
        "the startup sweep did not recover the orphaned message",
    ).toBeGreaterThan(0);
  });

  async function prepareFailure(status: number, permanentFailure: boolean) {
    await db.execute(sql`DELETE FROM embeddings WHERE message_id = ${testMessageId}`);
    await db.execute(sql`DELETE FROM embed_attempts WHERE message_id = ${testMessageId}`);
    vi.mocked(generateEmbeddingResult).mockClear();
    vi.mocked(generateEmbeddingResult).mockImplementation(async (_text, key) =>
      key === PLAINTEXT_API_KEY
        ? { vector: null, permanentFailure, status }
        : { vector: Array.from({ length: 1536 }, () => 1 / Math.sqrt(1536)), permanentFailure: false },
    );
  }

  function callsForFixture() {
    return vi.mocked(generateEmbeddingResult).mock.calls.filter((args) => args[1] === PLAINTEXT_API_KEY);
  }

  it.each([400, 401, 403, 422])(
    "persists HTTP %i and skips the message on a second sweep with a warning",
    async (status) => {
      await prepareFailure(status, true);
      const warn = vi.spyOn(logger, "warn");
      try {
        await reembedOrphanedMessages();
        const marker = await db.execute<{ http_status: number; embed_failed_at: Date }>(sql`
          SELECT http_status, embed_failed_at FROM embed_attempts WHERE message_id = ${testMessageId}
        `);
        expect(marker.rows).toHaveLength(1);
        expect(marker.rows[0]?.http_status).toBe(status);
        expect(marker.rows[0]?.embed_failed_at).toBeTruthy();
        expect(callsForFixture()).toHaveLength(1);

        await reembedOrphanedMessages();
        expect(callsForFixture()).toHaveLength(1);
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({ count: expect.any(Number) }),
          "Startup re-embed sweep: skipping messages with recorded permanent embedding failures",
        );
        const vectors = await db.execute(sql`
          SELECT message_id FROM embeddings WHERE message_id = ${testMessageId}
        `);
        expect(vectors.rows).toHaveLength(0);
      } finally {
        warn.mockRestore();
      }
    },
  );

  it.each([408, 425, 429, 500, 503])("keeps HTTP %i eligible for a later sweep", async (status) => {
    await prepareFailure(status, false);
    await reembedOrphanedMessages();
    await reembedOrphanedMessages();
    expect(callsForFixture()).toHaveLength(2);
    const markers = await db.execute(sql`
      SELECT message_id FROM embed_attempts WHERE message_id = ${testMessageId}
    `);
    expect(markers.rows).toHaveLength(0);
  });

  it.each([408, 425])("recovers a message after transient HTTP %i on a later sweep", async (status) => {
    await prepareFailure(status, false);
    await reembedOrphanedMessages();
    expect(callsForFixture()).toHaveLength(1);

    vi.mocked(generateEmbeddingResult).mockResolvedValue({
      vector: Array.from({ length: 1536 }, () => 1 / Math.sqrt(1536)),
      permanentFailure: false,
    });
    await reembedOrphanedMessages();
    expect(callsForFixture()).toHaveLength(2);
    const vectors = await db.execute(sql`
      SELECT message_id FROM embeddings WHERE message_id = ${testMessageId}
    `);
    expect(vectors.rows).toHaveLength(1);
  });

  it("removes failure records when the owning message is deleted", async () => {
    await prepareFailure(401, true);
    await reembedOrphanedMessages();
    await db.delete(messagesTable).where(eq(messagesTable.id, testMessageId));
    const markers = await db.execute(sql`
      SELECT message_id FROM embed_attempts WHERE message_id = ${testMessageId}
    `);
    expect(markers.rows).toHaveLength(0);
  });
});
