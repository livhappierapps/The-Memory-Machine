import { describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";

const TEST_USER_ID = "test-user-import-path-validation";

vi.mock("../middlewares/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).userId = TEST_USER_ID;
    next();
  },
}));

import importRouter from "../routes/import.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: Response, next: NextFunction) => {
    req.log = { error() {}, warn() {}, info() {}, debug() {} };
    next();
  });
  app.use(importRouter);
  return app;
}

function uploadChunk(uploadId: string, chunkIndex: string, totalChunks: string) {
  return request(createApp())
    .post("/import/chunk")
    .field("uploadId", uploadId)
    .field("chunkIndex", chunkIndex)
    .field("totalChunks", totalChunks)
    .attach("chunk", Buffer.from("test chunk"), {
      filename: "chunk.bin",
      contentType: "application/octet-stream",
    });
}

describe("import upload path validation", () => {
  it("rejects traversal-shaped upload IDs before building paths", async () => {
    const response = await uploadChunk("../../outside", "0", "1");
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid uploadId");
  });

  it.each([
    ["fractional index", "0.5", "1"],
    ["index outside total", "1", "1"],
    ["fractional total", "0", "1.5"],
    ["excessive total", "0", "10001"],
  ])("rejects invalid chunk metadata (%s)", async (_case, chunkIndex, totalChunks) => {
    const response = await uploadChunk("8c9c443a-1c50-4e82-b529-3faccc532b8b", chunkIndex, totalChunks);
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid chunk metadata");
  });
});
