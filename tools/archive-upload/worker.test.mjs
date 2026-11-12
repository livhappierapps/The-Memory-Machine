import test from "node:test";
import assert from "node:assert/strict";
import { createArchiveWorker, PART_SIZE, MAX_SIZE } from "./worker.mjs";

const OWNER = "owner@example.invalid";
const AUD = "test-archive-audience";
const ORIGIN = "https://archive.example.invalid";
const fingerprint = "a".repeat(64);
const worker = createArchiveWorker("<html><script>void 0</script></html>");

export function fixture() {
  const objects = new Map();
  const uploads = new Map();
  const bucket = {
    async get(key) {
      const value = objects.get(key);
      return value ? { json: async () => JSON.parse(value.body) } : null;
    },
    async put(key, body, options = {}) {
      objects.set(key, { body, customMetadata: options.customMetadata });
    },
    async head(key) {
      const object = objects.get(key);
      return object?.size !== undefined ? { size: object.size, etag: "saved-etag" } : null;
    },
    async list({ prefix }) {
      return {
        objects: [...objects].filter(([key]) => key.startsWith(prefix))
          .map(([key, value]) => ({ key, customMetadata: value.customMetadata })),
        truncated: false,
      };
    },
    async createMultipartUpload(key) {
      const uploadId = `upload-${uploads.size + 1}`;
      const parts = new Map();
      uploads.set(uploadId, parts);
      return { uploadId, abort: async () => uploads.delete(uploadId) };
    },
    resumeMultipartUpload(key, uploadId) {
      const parts = uploads.get(uploadId);
      return {
        async uploadPart(partNumber, data) {
          assert.ok(parts);
          parts.set(partNumber, { data, etag: `part-${partNumber}` });
          return { partNumber, etag: `part-${partNumber}` };
        },
        async complete(receipts) {
          assert.ok(parts);
          for (const receipt of receipts) {
            assert.equal(parts.get(receipt.partNumber)?.etag, receipt.etag);
          }
          const size = [...parts.values()].reduce((sum, part) => sum + part.data.byteLength, 0);
          objects.set(key, { size });
        },
      };
    },
  };
  const env = { ARCHIVES: bucket, OWNER_EMAIL: OWNER, ACCESS_AUD: AUD };
  const ctx = { access: { aud: AUD, getIdentity: async () => ({ email: OWNER }) } };
  async function call(path, { method = "GET", body, headers = {}, context = ctx } = {}) {
    if (body && !(body instanceof Uint8Array)) {
      body = JSON.stringify(body);
      headers["Content-Type"] ??= "application/json";
    }
    if (body instanceof Uint8Array) headers["Content-Length"] ??= String(body.byteLength);
    return worker.fetch(new Request(`${ORIGIN}${path}`, {
      method, body, headers: { Origin: ORIGIN, ...headers },
    }), env, context);
  }
  async function start(size = PART_SIZE + 22) {
    const response = await call("/api/uploads", {
      method: "POST", body: { name: "Leo Export.zip", size, lastModified: 1000, fingerprint },
    });
    assert.equal(response.status, 200);
    return response.json();
  }
  return { env, ctx, call, start, objects, uploads };
}

test("fails closed without validated Access context, even with a forged identity header", async () => {
  const f = fixture();
  const r = await f.call("/", { context: {}, headers: { "Cf-Access-Authenticated-User-Email": OWNER } });
  assert.equal(r.status, 401);
  assert.equal(f.objects.size, 0);
});

test("denies a different Access audience or account", async () => {
  const f = fixture();
  assert.equal((await f.call("/", { context: { access: { ...f.ctx.access, aud: "other" } } })).status, 401);
  assert.equal((await f.call("/", {
    context: { access: { ...f.ctx.access, getIdentity: async () => ({ email: "other@example.invalid" }) } },
  })).status, 403);
});

test("protects the page against caching and inline script injection", async () => {
  const r = await fixture().call("/");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Cache-Control"), "no-store");
  assert.match(r.headers.get("Content-Security-Policy"), /script-src 'nonce-/);
  assert.match(await r.text(), /<script nonce="/);
});

test("blocks cross-site writes", async () => {
  const f = fixture();
  const r = await f.call("/api/uploads", { method: "POST", body: {}, headers: { Origin: "https://other.invalid" } });
  assert.equal(r.status, 403);
  assert.equal(f.uploads.size, 0);
});

test("rejects oversize files before starting an upload", async () => {
  const f = fixture();
  const r = await f.call("/api/uploads", {
    method: "POST", body: { name: "archive.zip", size: MAX_SIZE + 1, lastModified: 1, fingerprint },
  });
  assert.equal(r.status, 400);
  assert.equal(f.uploads.size, 0);
});

test("a resumed start reuses the existing upload, with safe filename handling", async () => {
  const f = fixture();
  const first = await f.start();
  const second = await f.start();
  assert.equal(first.uploadId, second.uploadId);
  assert.equal(f.uploads.size, 1);
  assert.match(first.key, /Leo_Export\.zip$/);
});

test("rejects mismatched identifiers and unsafe keys", async () => {
  const f = fixture();
  const session = await f.start();
  const query = new URLSearchParams({ key: session.key, uploadId: "other" });
  assert.equal((await f.call(`/api/uploads/status?${query}`)).status, 404);
  assert.equal((await f.call("/api/uploads/status?key=../other&uploadId=anything")).status, 400);
});

test("does not finish an incomplete archive", async () => {
  const f = fixture();
  const session = await f.start();
  assert.equal((await f.call("/api/uploads/complete", { method: "POST", body: session })).status, 409);
  assert.equal(await f.env.ARCHIVES.head(session.key), null);
});

test("rejects invalid part lengths and content", async () => {
  const f = fixture();
  const session = await f.start(22);
  const query = new URLSearchParams({ key: session.key, uploadId: session.uploadId, partNumber: "1" });
  assert.equal((await f.call(`/api/uploads/part?${query}`, { method: "PUT", body: new Uint8Array(21) })).status, 400);
  assert.equal((await f.call(`/api/uploads/part?${query}`, { method: "PUT", body: new Uint8Array(22) })).status, 400);
});

test("resume preserves pieces; completion verifies size and is idempotent", async () => {
  const f = fixture();
  const session = await f.start();
  const query = new URLSearchParams({ key: session.key, uploadId: session.uploadId });
  const first = new Uint8Array(PART_SIZE);
  first.set([0x50, 0x4b, 3, 4]);
  assert.equal((await f.call(`/api/uploads/part?${query}&partNumber=1`, { method: "PUT", body: first })).status, 200);
  const resume = await (await f.call(`/api/uploads/status?${query}`)).json();
  assert.equal(resume.parts.length, 1);
  assert.equal(resume.parts[0].partNumber, 1);
  assert.equal((await f.call(`/api/uploads/part?${query}&partNumber=2`, {
    method: "PUT", body: new Uint8Array(22),
  })).status, 200);
  for (let i = 0; i < 2; i++) {
    const completed = await (await f.call("/api/uploads/complete", { method: "POST", body: session })).json();
    assert.equal(completed.completed, true);
    assert.equal(completed.size, PART_SIZE + 22);
  }
  const afterReload = await (await f.call(`/api/uploads/status?${query}`)).json();
  assert.equal(afterReload.completed, true);
  assert.equal(afterReload.size, session.size);
});

test("there is no browser API to delete or download the archive", async () => {
  const f = fixture();
  assert.equal((await f.call("/api/uploads", { method: "DELETE" })).status, 404);
  assert.equal((await f.call("/api/archive")).status, 404);
});
