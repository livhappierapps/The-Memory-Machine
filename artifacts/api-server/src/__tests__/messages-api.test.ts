/**
 * API-level integration tests for the messages routes.
 *
 * These tests spin up a real Express app backed by the live development
 * database and assert that:
 *   - GET /threads/:threadId/messages returns every message as plaintext
 *     (no `enc:v1:` prefix anywhere in the response body)
 *   - The streaming route persists the user message and the response body
 *     for the saved message object is plaintext
 *
 * Auth is bypassed via vi.mock so the test can inject a deterministic userId
 * without needing a live Clerk session.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import cookieParser from "cookie-parser";

const TEST_USER_ID = "test-user-api-messages-integration";
const ENC_PREFIX = "enc:v1:";

vi.mock("../middlewares/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).userId = TEST_USER_ID;
    next();
  },
}));

vi.mock("../lib/ai-provider.js", () => ({
  resolveChatKey: () => "fake-test-api-key",
  streamCompletion: vi.fn(
    async (
      _provider: unknown,
      _key: unknown,
      _model: unknown,
      _messages: unknown,
      callbacks: { onToken: (t: string) => void; onError: (m: string) => void; onDone: () => void },
    ) => {
      callbacks.onToken("Hello ");
      callbacks.onToken("world");
    },
  ),
}));

import { db, threadsTable, messagesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import messagesRouter from "../routes/messages.js";
import { encryptField } from "../lib/field-crypto.js";

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

let testThreadId: number;
let encryptedMsg1: string;
let encryptedMsg2: string;

beforeAll(async () => {
  const plaintext1 = "Hello — this is a private user message";
  const plaintext2 = "This is the assistant reply, also private";
  encryptedMsg1 = encryptField(TEST_USER_ID, plaintext1);
  encryptedMsg2 = encryptField(TEST_USER_ID, plaintext2);

  const [thread] = await db
    .insert(threadsTable)
    .values({
      userId: TEST_USER_ID,
      title: "Integration Test Thread (safe to delete)",
      model: "grok-3",
    })
    .returning({ id: threadsTable.id });

  testThreadId = thread!.id;

  await db.insert(messagesTable).values([
    {
      threadId: testThreadId,
      role: "user",
      content: encryptedMsg1,
      isSummary: false,
    },
    {
      threadId: testThreadId,
      role: "assistant",
      content: encryptedMsg2,
      isSummary: false,
    },
  ]);
});

afterAll(async () => {
  if (testThreadId) {
    await db.delete(messagesTable).where(eq(messagesTable.threadId, testThreadId));
    await db.delete(threadsTable).where(
      and(eq(threadsTable.id, testThreadId), eq(threadsTable.userId, TEST_USER_ID)),
    );
  }
});

describe("GET /threads/:threadId/messages — plaintext response contract", () => {
  it("returns HTTP 200 for a thread owned by the user", async () => {
    const app = buildTestApp();
    const res = await request(app).get(`/threads/${testThreadId}/messages`);
    expect(res.status).toBe(200);
  });

  it("returns an array of messages", async () => {
    const app = buildTestApp();
    const res = await request(app).get(`/threads/${testThreadId}/messages`);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  it("returns NO message whose content starts with enc:v1:", async () => {
    const app = buildTestApp();
    const res = await request(app).get(`/threads/${testThreadId}/messages`);
    expect(res.status).toBe(200);

    for (const msg of res.body as Array<{ content: string; role: string }>) {
      expect(
        msg.content.startsWith(ENC_PREFIX),
        `Expected plaintext but got encrypted content for role=${msg.role}: "${msg.content.slice(0, 30)}..."`,
      ).toBe(false);
    }
  });

  it("correctly decrypts the first message back to the original plaintext", async () => {
    const app = buildTestApp();
    const res = await request(app).get(`/threads/${testThreadId}/messages`);
    const msgs = res.body as Array<{ content: string; role: string }>;
    const userMsg = msgs.find((m) => m.role === "user");
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toBe("Hello — this is a private user message");
  });

  it("correctly decrypts the assistant reply back to the original plaintext", async () => {
    const app = buildTestApp();
    const res = await request(app).get(`/threads/${testThreadId}/messages`);
    const msgs = res.body as Array<{ content: string; role: string }>;
    const assistantMsg = msgs.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.content).toBe("This is the assistant reply, also private");
  });

  it("returns 404 for a thread that does not belong to the user", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/threads/999999999/messages");
    expect(res.status).toBe(404);
  });
});

describe("GET /messages/recent — plaintext response contract", () => {
  it("returns HTTP 200", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/messages/recent");
    expect(res.status).toBe(200);
  });

  it("returns an array", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/messages/recent");
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("returns NO message whose content starts with enc:v1:", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/messages/recent?limit=200");
    expect(res.status).toBe(200);

    for (const msg of res.body as Array<{ content: string }>) {
      expect(
        msg.content.startsWith(ENC_PREFIX),
        `Recent message has enc:v1: prefix — decryption was not applied`,
      ).toBe(false);
    }
  });
});

describe("POST /threads/:threadId/stream — plaintext SSE contract", () => {
  it("streams user_message event with plaintext content (no enc:v1: prefix)", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post(`/threads/${testThreadId}/stream`)
      .send({ content: "stream test input" });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);

    const events = parseSseEvents(res.text);
    const userMsgEvent = events.find((e) => e.type === "user_message") as
      | { type: string; message: { content: string } }
      | undefined;

    expect(userMsgEvent).toBeDefined();
    expect(userMsgEvent!.message.content).toBe("stream test input");
    expect(userMsgEvent!.message.content.startsWith(ENC_PREFIX)).toBe(false);
  });

  it("streams done event with plaintext assistant content (no enc:v1: prefix)", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post(`/threads/${testThreadId}/stream`)
      .send({ content: "another stream message" });

    expect(res.status).toBe(200);

    const events = parseSseEvents(res.text);
    const doneEvent = events.find((e) => e.type === "done") as
      | { type: string; message: { content: string } }
      | undefined;

    expect(doneEvent).toBeDefined();
    expect(doneEvent!.message.content).toBe("Hello world");
    expect(doneEvent!.message.content.startsWith(ENC_PREFIX)).toBe(false);
  });

  it("persisted assistant message is retrievable as plaintext via GET /messages", async () => {
    const app = buildTestApp();

    const streamRes = await request(app)
      .post(`/threads/${testThreadId}/stream`)
      .send({ content: "persist check message" });

    // Extract the id of the assistant message saved during this stream
    const doneEvent = parseSseEvents(streamRes.text).find((e) => e.type === "done") as
      | { type: string; message: { id: number; content: string } }
      | undefined;
    expect(doneEvent).toBeDefined();
    const streamedId = doneEvent!.message.id;

    const getRes = await request(app).get(`/threads/${testThreadId}/messages`);
    expect(getRes.status).toBe(200);

    const allMsgs = getRes.body as Array<{ id: number; role: string; content: string }>;

    // All messages (regardless of role) must be plaintext
    for (const m of allMsgs) {
      expect(
        m.content.startsWith(ENC_PREFIX),
        `Message id=${m.id} role=${m.role} has enc:v1: prefix — decryption was not applied on GET`,
      ).toBe(false);
    }

    // The specifically streamed assistant message must have the exact mocked content
    const streamedMsg = allMsgs.find((m) => m.id === streamedId);
    expect(streamedMsg).toBeDefined();
    expect(streamedMsg!.content).toBe("Hello world");
  });
});
