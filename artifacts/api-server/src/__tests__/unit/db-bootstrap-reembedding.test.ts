import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  generateEmbeddingResult: vi.fn(),
  storeEmbedding: vi.fn(),
}));
vi.mock("@workspace/db", () => ({ db: { execute: mocks.execute } }));
vi.mock("../../lib/embeddings", () => ({
  generateEmbeddingResult: mocks.generateEmbeddingResult,
  storeEmbedding: mocks.storeEmbedding,
}));
vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { reembedOrphanedMessages } from "../../lib/db-bootstrap";
import { encryptField } from "../../lib/field-crypto";

const vector = Array.from({ length: 1536 }, () => 0.1);
const orphans = [
  {
    message_id: 11, thread_id: 21, profile_id: 31, user_id: "owner-one",
    encrypted_content: encryptField("owner-one", "First missing memory."),
    api_key: encryptField("owner-one", "fake-xai-key"),
    open_ai_api_key: null, embedding_provider: "xai",
  },
  {
    message_id: 12, thread_id: 22, profile_id: 32, user_id: "owner-two",
    encrypted_content: encryptField("owner-two", "Second missing memory."),
    api_key: encryptField("owner-two", "unused-xai-key"),
    open_ai_api_key: encryptField("owner-two", "fake-openai-key"),
    embedding_provider: "openai",
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.execute
    .mockResolvedValueOnce({ rows: [{ count: "0" }] })
    .mockResolvedValueOnce({ rows: orphans });
  mocks.generateEmbeddingResult.mockResolvedValue({ vector, permanentFailure: false });
  mocks.storeEmbedding.mockResolvedValue(true);
});

describe("startup recovery of missing embeddings", () => {
  it("selects messages without an embedding and stores a vector for every orphan", async () => {
    await reembedOrphanedMessages();

    expect(mocks.execute).toHaveBeenCalledTimes(2);
    // Compile the real Drizzle SQL without connecting to PostgreSQL. Checking
    // the anti-join matters: returning canned rows alone cannot catch a query
    // regression that starts selecting already-embedded messages.
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[1][0] as SQL);
    const text = query.sql.replace(/\s+/g, " ").trim();
    expect(text).toContain("FROM messages m");
    expect(text).toContain("LEFT JOIN embeddings e ON e.message_id = m.id");
    expect(text).toContain("WHERE e.id IS NULL");
    // Failure markers only exclude a message for the *current* model config.
    expect(text).toContain("NOT EXISTS ( SELECT 1 FROM embed_attempts a WHERE a.message_id = m.id AND a.model_key IN");
    expect(text).toContain("AND t.deleted_at IS NULL");
    expect(text).toMatch(/LIMIT \$\d+/);
    expect(query.params).toContain(200);

    expect(mocks.generateEmbeddingResult.mock.calls).toEqual([
      ["First missing memory.", "fake-xai-key", "xai", "passage"],
      ["Second missing memory.", "fake-openai-key", "openai", "passage"],
    ]);
    expect(mocks.storeEmbedding.mock.calls).toEqual([
      [11, 21, 31, vector],
      [12, 22, 32, vector],
    ]);
  });

  it("does not call the provider or storage when no orphaned messages exist", async () => {
    mocks.execute.mockReset()
      .mockResolvedValueOnce({ rows: [{ count: "0" }] })
      .mockResolvedValueOnce({ rows: [] });
    await reembedOrphanedMessages();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(mocks.generateEmbeddingResult).not.toHaveBeenCalled();
    expect(mocks.storeEmbedding).not.toHaveBeenCalled();
  });

  it("continues recovering later messages if one embedding generation throws", async () => {
    mocks.generateEmbeddingResult.mockRejectedValueOnce(new Error("provider unavailable"));
    await reembedOrphanedMessages();
    expect(mocks.generateEmbeddingResult).toHaveBeenCalledTimes(2);
    expect(mocks.storeEmbedding.mock.calls).toEqual([[12, 22, 32, vector]]);
  });
});
