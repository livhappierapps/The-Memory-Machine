import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getMissingChunkIndexes,
  parsePendingImportSession,
  pendingImportStorageKey,
} from "./import-resume";

const validSession = {
  uploadId: "1d795ea0-9148-4f9d-86c9-c8d9a1878a0b",
  fileName: "export.zip",
  mimeType: "application/zip",
  fileSize: 20_000_000,
  totalChunks: 2,
  fileSignature: "a".repeat(64),
  updatedAt: "2026-11-13T15:00:00.000Z",
};

describe("restart-safe import metadata", () => {
  it("scopes the saved session key to the signed-in account", () => {
    assert.notEqual(
      pendingImportStorageKey("user/a"),
      pendingImportStorageKey("user/b"),
    );
  });

  it("loads only well-formed, bounded session metadata", () => {
    assert.deepEqual(
      parsePendingImportSession(JSON.stringify(validSession)),
      validSession,
    );
    assert.equal(parsePendingImportSession("{"), null);
    assert.equal(
      parsePendingImportSession(
        JSON.stringify({ ...validSession, totalChunks: 10_001 }),
      ),
      null,
    );
    assert.equal(
      parsePendingImportSession(
        JSON.stringify({ ...validSession, uploadId: "../outside" }),
      ),
      null,
    );
    assert.equal(
      parsePendingImportSession(
        JSON.stringify({ ...validSession, fileSignature: "not-a-sha256" }),
      ),
      null,
    );
  });

  it("returns only server-missing chunk indexes", () => {
    assert.deepEqual(getMissingChunkIndexes(5, [0, 2, 2, -1, 99]), [1, 3, 4]);
  });
});
