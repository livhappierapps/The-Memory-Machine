import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectArchive } from "./inspect.mjs";

function archive() {
  const names = ["export/grok-backend.json", "images/a.png", "images/"];
  const entries = names.map((name) => {
    const bytes = Buffer.from(name);
    const entry = Buffer.alloc(46 + bytes.length);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(123, 16);
    entry.writeUInt32LE(40, 20);
    entry.writeUInt32LE(80, 24);
    entry.writeUInt16LE(bytes.length, 28);
    entry.writeUInt32LE(0, 42);
    bytes.copy(entry, 46);
    return entry;
  });
  const body = Buffer.alloc(128);
  const directory = Buffer.concat(entries);
  const trailer = Buffer.alloc(22);
  trailer.writeUInt32LE(0x06054b50, 0);
  trailer.writeUInt16LE(names.length, 8);
  trailer.writeUInt16LE(names.length, 10);
  trailer.writeUInt32LE(directory.length, 12);
  trailer.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, directory, trailer]);
}

function bucket(bytes) {
  return {
    head: async () => ({ size: bytes.length }),
    get: async (_key, { range: { offset, length } }) => ({
      arrayBuffer: async () => Uint8Array.from(bytes.subarray(offset, offset + length)).buffer,
    }),
  };
}

test("reads only bounded ranges and identifies JSON without extracting media", async () => {
  const result = await inspectArchive(bucket(archive()), "original.zip");
  assert.equal(result.entries, 3);
  assert.deepEqual(result.types, { json: 1, png: 1, directory: 1 });
  assert.deepEqual(result.json, [{
    name: "export/grok-backend.json", flags: 0, method: 8,
    crc32: 123, compressedSize: 40, size: 80, offset: 0,
  }]);
});

test("rejects missing, corrupt and multi-disk trailers", async () => {
  await assert.rejects(inspectArchive(bucket(Buffer.alloc(100)), "bad.zip"), /trailer/);
  const bytes = archive();
  bytes.writeUInt16LE(1, bytes.length - 18);
  await assert.rejects(inspectArchive(bucket(bytes), "multi.zip"), /Multi-disk/);
});

test("rejects out-of-bounds central directory", async () => {
  const bytes = archive();
  bytes.writeUInt32LE(0xffffff, bytes.length - 6);
  await assert.rejects(inspectArchive(bucket(bytes), "bad.zip"), /outside/);
});
