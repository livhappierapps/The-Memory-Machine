/**
 * import-chunked.test.ts — Integration tests for the chunked ZIP import flow.
 *
 * Validates the full pipeline that a real device exercises:
 *   1. POST /api/import/chunk  × N  — uploads file in pieces
 *   2. POST /api/import/finalize    — assembles, parses, inserts, streams SSE
 *
 * Scenarios covered:
 *   A. Single-chunk upload of a valid Grok ZIP → done event + DB rows
 *   B. Multi-chunk upload (file split across 3 chunks) → all chunks assembled correctly
 *   C. Wrong-format ZIP (no JSON inside) → error event with descriptive message
 *   D. Valid JSON file (non-ZIP) import → done event
 *   E. Bad uploadId → 400 from /chunk and /finalize
 *   F. Missing chunk file → 400 from /chunk
 *   G. Finalize with totalChunks mismatch → assembler detects missing chunk
 *   H. SSE progress events appear between conversations (batch size = 20)
 *
 * Auth is bypassed via vi.mock.
 * Embeddings are mocked so no real API key is needed.
 * All DB rows are cleaned up in afterAll.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import JSZip from "jszip";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { db, threadsTable, messagesTable, importStatusesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import * as importStream from "../lib/import-stream.js";
import { ensureImportStatusSchema, getImportStatusForOwner } from "../lib/import-status-store.js";

// ── Mocks (must be declared before module imports) ─────────────────────────────

const TEST_USER_ID = "test-user-import-chunked-integration";

vi.mock("../middlewares/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    const testUserId = req.headers["x-test-user-id"];
    (req as any).userId = typeof testUserId === "string" ? testUserId : TEST_USER_ID;
    next();
  },
}));

// Embeddings are fire-and-forget; mock them out so no real API call happens
vi.mock("../lib/embeddings.js", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(null),
  storeEmbedding: vi.fn().mockResolvedValue(true),
  embedMessageAsync: vi.fn(),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import importRouter from "../routes/import.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Parse newline-delimited SSE body into an array of event objects. */
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

/** Build an Express app wired up with the import router and a stub req.log. */
function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: Response, next: NextFunction) => {
    req.log = {
      error: () => {},
      warn: () => {},
      info: () => {},
      debug: () => {},
    };
    next();
  });
  app.use(importRouter);
  return app;
}

/** Create a minimal Grok-format conversations JSON buffer. */
function makeConversationsJson(count: number): Buffer {
  const conversations = Array.from({ length: count }, (_, i) => ({
    title: `Test conversation ${i + 1}`,
    messages: [
      { role: "user", content: `Hello from conversation ${i + 1}` },
      { role: "assistant", content: `Reply from conversation ${i + 1}` },
    ],
  }));
  return Buffer.from(JSON.stringify(conversations), "utf8");
}

/** Create a ZIP buffer containing a conversations JSON file. */
async function makeGrokZip(conversationCount: number): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("grok-backend-conversations.json", makeConversationsJson(conversationCount));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/**
 * Upload a file buffer in `chunkCount` pieces via POST /api/import/chunk,
 * then call POST /api/import/finalize and return the SSE body.
 */
async function runChunkedImport(
  app: ReturnType<typeof buildTestApp>,
  fileBuffer: Buffer,
  isZip: boolean,
  uploadId: string,
  chunkCount: number,
): Promise<{ finalizeStatus: number; events: Array<Record<string, unknown>> }> {
  const chunkSize = Math.ceil(fileBuffer.length / chunkCount);

  for (let i = 0; i < chunkCount; i++) {
    const slice = fileBuffer.subarray(i * chunkSize, Math.min((i + 1) * chunkSize, fileBuffer.length));
    const res = await request(app)
      .post("/import/chunk")
      .field("uploadId", uploadId)
      .field("chunkIndex", String(i))
      .field("totalChunks", String(chunkCount))
      .attach("chunk", slice, { filename: "chunk.bin", contentType: "application/octet-stream" });

    expect(res.status, `chunk ${i} upload status`).toBe(200);
    expect((res.body as Record<string, unknown>).received).toBe(true);
    expect((res.body as Record<string, unknown>).chunkIndex).toBe(i);
  }

  const finalizeRes = await request(app)
    .post("/import/finalize")
    .send({ uploadId, totalChunks: chunkCount, isZip });

  return {
    finalizeStatus: finalizeRes.status,
    events: parseSseEvents(finalizeRes.text ?? ""),
  };
}

// ── Shared state ───────────────────────────────────────────────────────────────

const insertedThreadIds: number[] = [];

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("Chunked ZIP import — end-to-end API", () => {
  let app: ReturnType<typeof buildTestApp>;

  beforeAll(async () => {
    await ensureImportStatusSchema();
    app = buildTestApp();
  });

  afterAll(async () => {
    // Delete all threads (and cascade-deleted messages) created by these tests
    if (insertedThreadIds.length > 0) {
      await db.delete(threadsTable).where(inArray(threadsTable.id, insertedThreadIds));
    }
    // Clean up any remaining test threads by userId in case something slipped through
    await db.delete(threadsTable).where(eq(threadsTable.userId, TEST_USER_ID));
    await db.delete(importStatusesTable).where(eq(importStatusesTable.userId, TEST_USER_ID));
  });

  // ── A. Single-chunk import ─────────────────────────────────────────────────

  it("A: imports a single-chunk Grok ZIP and emits a done event", async () => {
    const zip = await makeGrokZip(3);
    const uploadId = crypto.randomUUID();

    const { finalizeStatus, events } = await runChunkedImport(app, zip, true, uploadId, 1);

    expect(finalizeStatus).toBe(200);

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent, "done event must be emitted").toBeTruthy();
    expect(doneEvent!.imported).toBe(3);
    expect(doneEvent!.skipped).toBe(0);
    expect(doneEvent!.errors).toBe(0);

    // Verify threads were actually written to the DB
    const threads = await db
      .select({ id: threadsTable.id })
      .from(threadsTable)
      .where(eq(threadsTable.userId, TEST_USER_ID));
    insertedThreadIds.push(...threads.map((t) => t.id));
    expect(threads.length).toBeGreaterThanOrEqual(3);
  });

  // ── B. Multi-chunk upload ──────────────────────────────────────────────────

  it("B: reassembles a file uploaded in 3 chunks and produces correct results", async () => {
    const zip = await makeGrokZip(5);
    const uploadId = crypto.randomUUID();

    const { finalizeStatus, events } = await runChunkedImport(app, zip, true, uploadId, 3);

    expect(finalizeStatus).toBe(200);

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent, "done event").toBeTruthy();
    expect(doneEvent!.imported).toBe(5);
    expect(doneEvent!.errors).toBe(0);

    // All chunks → same assembled file → all conversations inserted
    const threads = await db
      .select({ id: threadsTable.id, title: threadsTable.title })
      .from(threadsTable)
      .where(eq(threadsTable.userId, TEST_USER_ID));
    insertedThreadIds.push(...threads.map((t) => t.id));
  });

  // ── C. Wrong-format ZIP ────────────────────────────────────────────────────

  it("C: sends an error SSE event when the ZIP contains no JSON", async () => {
    const zip = new JSZip();
    zip.file("not-a-grok-export.txt", "Hello world");
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const uploadId = crypto.randomUUID();

    const { finalizeStatus, events } = await runChunkedImport(app, zipBuffer, true, uploadId, 1);

    expect(finalizeStatus).toBe(200); // SSE always returns 200; errors arrive as events
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent, "error event must be emitted for wrong-format ZIP").toBeTruthy();
    expect(typeof errorEvent!.message).toBe("string");
    expect((errorEvent!.message as string).length).toBeGreaterThan(0);
  });

  // ── D. Valid JSON (non-ZIP) import ─────────────────────────────────────────

  it("D: imports a raw JSON file (non-ZIP) successfully", async () => {
    const jsonBuf = makeConversationsJson(2);
    const uploadId = crypto.randomUUID();

    const { finalizeStatus, events } = await runChunkedImport(app, jsonBuf, false, uploadId, 1);

    expect(finalizeStatus).toBe(200);
    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent, "done event for JSON import").toBeTruthy();
    expect(doneEvent!.imported).toBe(2);
  });

  // ── E. Bad uploadId ────────────────────────────────────────────────────────

  it("E: rejects /chunk with 400 when uploadId is not a UUID", async () => {
    const smallFile = Buffer.from("hello");
    const res = await request(app)
      .post("/import/chunk")
      .field("uploadId", "not-a-uuid")
      .field("chunkIndex", "0")
      .field("totalChunks", "1")
      .attach("chunk", smallFile, { filename: "chunk.bin", contentType: "application/octet-stream" });

    expect(res.status).toBe(400);
  });

  it("E: rejects /finalize with 400 when uploadId is not a UUID", async () => {
    const res = await request(app)
      .post("/import/finalize")
      .send({ uploadId: "bad-id", totalChunks: 1, isZip: false });

    expect(res.status).toBe(400);
  });

  // ── F. Missing chunk file ──────────────────────────────────────────────────

  it("F: rejects /chunk with 400 when no file is attached", async () => {
    const res = await request(app)
      .post("/import/chunk")
      .field("uploadId", crypto.randomUUID())
      .field("chunkIndex", "0")
      .field("totalChunks", "1");
    // multer returns 400 or 500 when required file field is absent
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  // ── G. Missing chunk in finalize ──────────────────────────────────────────

  it("G: finalize with a missing chunk sends an error SSE event", async () => {
    const uploadId = crypto.randomUUID();
    // Declare 2 chunks but only upload chunk 0
    const sliceA = Buffer.from("chunk0data");
    await request(app)
      .post("/import/chunk")
      .field("uploadId", uploadId)
      .field("chunkIndex", "0")
      .field("totalChunks", "2")
      .attach("chunk", sliceA, { filename: "chunk.bin", contentType: "application/octet-stream" });

    const finalizeRes = await request(app)
      .post("/import/finalize")
      .send({ uploadId, totalChunks: 2, isZip: false });

    expect(finalizeRes.status).toBe(200);
    const events = parseSseEvents(finalizeRes.text ?? "");
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent, "error event when chunk is missing").toBeTruthy();
  });

  // ── H. SSE progress events for large imports ────────────────────────────────

  it("H: emits progress events when conversations exceed the batch size (20)", async () => {
    // 25 conversations → at least one flush mid-stream (batch=20) → at least one progress event
    const zip = await makeGrokZip(25);
    const uploadId = crypto.randomUUID();

    const { finalizeStatus, events } = await runChunkedImport(app, zip, true, uploadId, 2);

    expect(finalizeStatus).toBe(200);
    const progressEvents = events.filter((e) => e.type === "progress");
    expect(progressEvents.length, "at least one progress event for 25 conversations").toBeGreaterThanOrEqual(1);

    // Each progress event must carry the running imported count
    for (const ev of progressEvents) {
      expect(typeof ev.imported).toBe("number");
      expect(typeof ev.processed).toBe("number");
    }

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent, "done event after progress events").toBeTruthy();
    expect(doneEvent!.imported).toBe(25);
  });

  // ── Chunk endpoint happy-path details ──────────────────────────────────────

  it("returns { received: true, chunkIndex: N } from /chunk", async () => {
    const uploadId = crypto.randomUUID();
    const res = await request(app)
      .post("/import/chunk")
      .field("uploadId", uploadId)
      .field("chunkIndex", "7")
      .field("totalChunks", "10")
      .attach("chunk", Buffer.from("data"), { filename: "chunk.bin", contentType: "application/octet-stream" });

    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).received).toBe(true);
    expect((res.body as Record<string, unknown>).chunkIndex).toBe(7);
  });

  // ── Status event on finalize ───────────────────────────────────────────────

  it("emits an early status event immediately after finalize begins", async () => {
    const zip = await makeGrokZip(1);
    const uploadId = crypto.randomUUID();

    const { events } = await runChunkedImport(app, zip, true, uploadId, 1);

    const statusEvents = events.filter((e) => e.type === "status");
    expect(statusEvents.length, "at least one status event").toBeGreaterThanOrEqual(1);
    expect(typeof statusEvents[0]!.message).toBe("string");
  });

  it("stores the final result and refuses to finalize the same upload twice", async () => {
    const zip = await makeGrokZip(2);
    const uploadId = crypto.randomUUID();
    const { events } = await runChunkedImport(app, zip, true, uploadId, 1);
    expect(events.some((event) => event.type === "done")).toBe(true);

    const status = await request(app).get(`/import/${uploadId}/status`).expect(200);
    expect(status.body).toMatchObject({
      uploadId,
      status: "done",
      imported: 2,
      skipped: 0,
      errors: 0,
      message: null,
    });
    expect(status.body.completedAt).toEqual(expect.any(String));

    const beforeDuplicate = await db
      .select({ id: threadsTable.id })
      .from(threadsTable)
      .where(eq(threadsTable.userId, TEST_USER_ID));
    await request(app)
      .post("/import/finalize")
      .send({ uploadId: uploadId.toUpperCase(), totalChunks: 1, isZip: true })
      .expect(409);
    const afterDuplicate = await db
      .select({ id: threadsTable.id })
      .from(threadsTable)
      .where(eq(threadsTable.userId, TEST_USER_ID));
    expect(afterDuplicate).toHaveLength(beforeDuplicate.length);
  });

  it("does not expose an import status to a different authenticated owner", async () => {
    const zip = await makeGrokZip(1);
    const uploadId = crypto.randomUUID();
    await runChunkedImport(app, zip, true, uploadId, 1);

    await request(app)
      .get(`/import/${uploadId}/status`)
      .set("x-test-user-id", "different-import-owner")
      .expect(404);
  });

  it("lists only the owner's staged chunks and safely discards an unfinished upload", async () => {
    const zip = await makeGrokZip(1);
    const uploadId = crypto.randomUUID();
    const half = Math.floor(zip.length / 2);

    await request(app)
      .post("/import/chunk")
      .field("uploadId", uploadId)
      .field("chunkIndex", "0")
      .field("totalChunks", "2")
      .attach("chunk", zip.subarray(0, half), {
        filename: "chunk.bin",
        contentType: "application/octet-stream",
      })
      .expect(200);

    const ownerInventory = await request(app)
      .get(`/import/${uploadId}/chunks`)
      .expect(200);
    expect(ownerInventory.body).toEqual({
      uploadId,
      receivedChunks: [0],
    });

    const otherOwnerInventory = await request(app)
      .get(`/import/${uploadId}/chunks`)
      .set("x-test-user-id", "different-import-owner")
      .expect(200);
    expect(otherOwnerInventory.body.receivedChunks).toEqual([]);

    await request(app)
      .delete(`/import/${uploadId}/chunks`)
      .set("x-test-user-id", "different-import-owner")
      .expect(204);
    const stillOwned = await request(app)
      .get(`/import/${uploadId}/chunks`)
      .expect(200);
    expect(stillOwned.body.receivedChunks).toEqual([0]);

    await request(app).delete(`/import/${uploadId}/chunks`).expect(204);
    const afterDiscard = await request(app)
      .get(`/import/${uploadId}/chunks`)
      .expect(200);
    expect(afterDiscard.body.receivedChunks).toEqual([]);
  });

  it("persists the final result when the SSE client disconnects", async () => {
    const zip = await makeGrokZip(1);
    const uploadId = crypto.randomUUID();
    await request(app)
      .post("/import/chunk")
      .field("uploadId", uploadId)
      .field("chunkIndex", "0")
      .field("totalChunks", "1")
      .attach("chunk", zip, { filename: "chunk.bin", contentType: "application/octet-stream" })
      .expect(200);

    const streamSpy = vi.spyOn(importStream, "streamImportFile").mockImplementation(
      async (_filePath, _isZip, _userId, onEvent) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        onEvent({ type: "done", imported: 4, skipped: 1, errors: 0 });
      },
    );
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;

    try {
      await new Promise<void>((resolve, reject) => {
        const req = httpRequest(
          {
            hostname: "127.0.0.1",
            port: address.port,
            path: "/import/finalize",
            method: "POST",
            headers: { "content-type": "application/json" },
          },
          (res) => {
            res.once("data", () => {
              res.destroy();
              resolve();
            });
            res.once("error", () => resolve());
          },
        );
        req.once("error", (err) => {
          if ((err as NodeJS.ErrnoException).code === "ECONNRESET") resolve();
          else reject(err);
        });
        req.end(JSON.stringify({ uploadId, totalChunks: 1, isZip: true }));
      });

      let status = await getImportStatusForOwner(TEST_USER_ID, uploadId);
      for (let attempt = 0; attempt < 40 && status?.status === "processing"; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        status = await getImportStatusForOwner(TEST_USER_ID, uploadId);
      }
      expect(streamSpy).toHaveBeenCalledOnce();
      expect(status).toMatchObject({
        status: "done",
        imported: 4,
        skipped: 1,
        errors: 0,
      });
    } finally {
      streamSpy.mockRestore();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
