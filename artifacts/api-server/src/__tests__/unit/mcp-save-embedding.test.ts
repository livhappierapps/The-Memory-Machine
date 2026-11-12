import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { setImmediate } from "node:timers/promises";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
  generateEmbedding: vi.fn(),
  storeEmbedding: vi.fn(),
}));

vi.mock("@workspace/db", async () => ({
  ...await import("@workspace/db/schema"),
  db: { select: mocks.select, insert: mocks.insert, execute: mocks.execute },
}));
vi.mock("../../lib/embeddings", () => ({
  generateEmbedding: mocks.generateEmbedding,
  storeEmbedding: mocks.storeEmbedding,
}));
vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import mcpRouter from "../../routes/mcp";
import { encryptField } from "../../lib/field-crypto";
import { messagesTable, threadsTable } from "@workspace/db/schema";

const userId = "embedding-unit-user";
const vector = Array.from({ length: 1536 }, () => 0.1);
const app = express();
app.use(express.json());
app.use(mcpRouter);

function saveMemory() {
  return request(app).post("/mcp")
    .set("Authorization", "Bearer fake-unit-token")
    .set("Accept", "application/json, text/event-stream")
    .send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "save_memory",
        arguments: { title: "Restart-safe note", content: "Remember this.", tags: ["work"] },
      },
    });
}

function parseResult(response: { text: string; headers: Record<string, string> }) {
  const json = response.headers["content-type"]?.includes("text/event-stream")
    ? response.text.split("\n").find((line) => line.startsWith("data: "))?.slice(6)
    : response.text;
  return JSON.parse(json ?? "{}");
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.execute.mockResolvedValue({ rows: [] });
  mocks.generateEmbedding.mockResolvedValue(vector);
  mocks.storeEmbedding.mockResolvedValue(true);
  mocks.insert.mockImplementation((table) => ({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(
        table === threadsTable ? [{ id: 101 }] : table === messagesTable ? [{ id: 202 }] : [],
      ),
    }),
  }));
});

function mockProfile(provider: "xai" | "openai") {
  const profile = {
    id: 303,
    apiKey: encryptField(userId, "fake-xai-key"),
    openAiApiKey: encryptField(userId, "fake-openai-key"),
    embeddingProvider: provider,
  };
  // First SELECT authenticates the token; second loads the default profile.
  for (const rows of [[{ userId }], [profile]]) {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(rows),
    };
    mocks.select.mockReturnValueOnce(chain);
  }
}

describe("save_memory embedding persistence", () => {
  it.each(["xai", "openai"] as const)(
    "waits for the %s embedding DB write before returning success",
    async (provider) => {
      mockProfile(provider);
      let finishWrite!: (stored: boolean) => void;
      mocks.storeEmbedding.mockImplementation(() => new Promise<boolean>((resolve) => {
        finishWrite = resolve;
      }));

      let responseReturned = false;
      const pendingResponse = saveMemory().then((response) => {
        responseReturned = true;
        return response;
      });

      try {
        await vi.waitFor(() => expect(mocks.storeEmbedding).toHaveBeenCalledTimes(1));
        // Allow HTTP/promise callbacks to run while the write is deliberately
        // unresolved. A fire-and-forget regression would return in this window.
        await setImmediate();
        await setImmediate();
        expect(responseReturned).toBe(false);
        expect(mocks.generateEmbedding).toHaveBeenCalledWith(
          "[Tags: work]\n\nRemember this.",
          provider === "openai" ? "fake-openai-key" : "fake-xai-key",
          provider,
          "passage",
        );
        expect(mocks.storeEmbedding).toHaveBeenCalledWith(202, 101, 303, vector);
      } finally {
        // Always release the gate, including on assertion failure.
        finishWrite?.(true);
      }

      const response = await pendingResponse;
      expect(response.status).toBe(200);
      const body = parseResult(response);
      expect(body.error).toBeUndefined();
      expect(body.result.isError).not.toBe(true);
      expect(body.result.content[0].text).toContain('Memory saved (pinned): "Restart-safe note" (ID: #101)');
      expect(body.result.content[0].text).not.toContain("could not be persisted");
    },
  );

  it("warns that semantic search may miss the memory when persistence fails", async () => {
    mockProfile("xai");
    mocks.storeEmbedding.mockResolvedValue(false);
    const response = await saveMemory();
    expect(mocks.storeEmbedding).toHaveBeenCalledWith(202, 101, 303, vector);
    expect(response.status).toBe(200);
    expect(parseResult(response).result.content[0].text).toContain("embedding could not be persisted");
  });
});
