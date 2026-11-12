// A private transfer utility, not a replacement for Memory Machine's importer.
// Cloudflare Access must protect this Worker. Missing Access context fails closed.
export const PART_SIZE = 8 * 1024 * 1024;
export const MAX_SIZE = 3 * 1024 * 1024 * 1024;
const SESSION_PREFIX = "__upload_sessions/";
const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function json(value, status = 200) {
  return Response.json(value, { status, headers: HEADERS });
}

async function readJson(request) {
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
    fail(415, "Expected JSON.");
  }
  const reader = request.body?.getReader();
  if (!reader) fail(400, "Missing request body.");
  let bytes = 0;
  const chunks = [];
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > 8192) {
      await reader.cancel();
      fail(413, "Request is too large.");
    }
    chunks.push(next.value);
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(combined));
  } catch {
    fail(400, "Invalid JSON.");
  }
}

function sessionPath(fingerprint) {
  if (!/^[a-f0-9]{64}$/.test(fingerprint ?? "")) fail(400, "Invalid file fingerprint.");
  return `${SESSION_PREFIX}${fingerprint}/session.json`;
}

function fingerprintFromKey(key) {
  const match = /^archives\/([a-f0-9]{64})\/[a-zA-Z0-9._-]{1,120}\.zip$/.exec(key ?? "");
  if (!match) fail(400, "Invalid archive key.");
  return match[1];
}

async function loadSession(bucket, key, uploadId) {
  const fingerprint = fingerprintFromKey(key);
  const stored = await bucket.get(sessionPath(fingerprint));
  if (!stored) fail(404, "Upload not found. Do not delete your original ZIP.");
  const session = await stored.json();
  if (session.key !== key || session.uploadId !== uploadId) fail(404, "Upload not found.");
  return session;
}

async function readParts(bucket, session) {
  const prefix = `${SESSION_PREFIX}${session.fingerprint}/parts/`;
  const parts = [];
  let cursor;
  do {
    // Read receipts from list metadata, not a separate subrequest per part.
    // A 2 GB upload must still fit the free Worker's subrequest limit.
    const listed = await bucket.list({ prefix, limit: 1000, include: ["customMetadata"], cursor });
    for (const object of listed.objects) {
      const metadata = object.customMetadata;
      if (!metadata?.etag) fail(409, "Upload receipt is missing. Please resume.");
      parts.push({
        partNumber: Number(metadata.partNumber),
        etag: metadata.etag,
        size: Number(metadata.size),
      });
    }
    if (parts.length > Math.ceil(MAX_SIZE / PART_SIZE)) fail(409, "Unexpected upload receipts.");
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return parts.sort((a, b) => a.partNumber - b.partNumber);
}

async function status(bucket, session) {
  const archive = await bucket.head(session.key);
  if (archive) {
    if (archive.size !== session.size) fail(409, "Archive size does not match. Keep your original ZIP.");
    return { ...session, completed: true, etag: archive.etag, parts: [] };
  }
  return { ...session, completed: false, parts: await readParts(bucket, session) };
}

export function createArchiveWorker(page) {
  return {
    async fetch(request, env, ctx) {
      try {
        if (!ctx?.access || !env.OWNER_EMAIL || !env.ACCESS_AUD ||
            ctx.access.aud !== env.ACCESS_AUD) {
          return json({ error: "Sign in through the private Cloudflare upload link." }, 401);
        }
        const identity = await ctx.access.getIdentity();
        if (!identity?.email || identity.email.toLowerCase() !== env.OWNER_EMAIL.toLowerCase()) {
          return json({ error: "This archive belongs to a different account." }, 403);
        }
        const url = new URL(request.url);
        if (request.method !== "GET" && request.method !== "HEAD") {
          if (request.headers.get("Origin") !== url.origin) {
            return json({ error: "Upload requests must come from this private page." }, 403);
          }
        }
        const bucket = env.ARCHIVES;
        if (url.pathname === "/" && request.method === "GET") {
          const nonce = crypto.randomUUID();
          return new Response(page.replace("<script>", `<script nonce="${nonce}">`), {
            headers: {
              ...HEADERS,
              "Content-Type": "text/html; charset=utf-8",
              "Content-Security-Policy": `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
            },
          });
        }
        if (url.pathname === "/api/uploads" && request.method === "POST") {
          const input = await readJson(request);
          if (typeof input.name !== "string" || !/\.zip$/i.test(input.name) ||
              input.name.length > 250 || !Number.isSafeInteger(input.size) ||
              input.size < 22 || input.size > MAX_SIZE ||
              !Number.isSafeInteger(input.lastModified) || input.lastModified < 0) {
            fail(400, "Choose the original ZIP file, no larger than 3 GiB.");
          }
          const path = sessionPath(input.fingerprint);
          const existing = await bucket.get(path);
          if (existing) {
            const session = await existing.json();
            if (session.size !== input.size || session.name !== input.name ||
                session.lastModified !== input.lastModified) {
              fail(409, "File does not match this upload. Keep the original file.");
            }
            return json(await status(bucket, session));
          }
          const name = input.name.replace(/\.zip$/i, "").replace(/[^a-zA-Z0-9._-]/g, "_")
            .slice(0, 120) || "archive";
          const key = `archives/${input.fingerprint}/${name}.zip`;
          const upload = await bucket.createMultipartUpload(key, {
            httpMetadata: { contentType: "application/zip" },
            customMetadata: { originalName: input.name, fingerprint: input.fingerprint },
          });
          const session = {
            name: input.name, size: input.size, lastModified: input.lastModified,
            fingerprint: input.fingerprint, key, uploadId: upload.uploadId,
            partSize: PART_SIZE, createdAt: new Date().toISOString(),
          };
          try {
            await bucket.put(path, JSON.stringify(session), {
              httpMetadata: { contentType: "application/json" },
            });
          } catch (error) {
            await upload.abort();
            throw error;
          }
          return json({ ...session, parts: [], completed: false });
        }
        if (url.pathname === "/api/uploads/status" && request.method === "GET") {
          const session = await loadSession(bucket, url.searchParams.get("key"), url.searchParams.get("uploadId"));
          return json(await status(bucket, session));
        }
        if (url.pathname === "/api/uploads/part" && request.method === "PUT") {
          const session = await loadSession(bucket, url.searchParams.get("key"), url.searchParams.get("uploadId"));
          const number = Number(url.searchParams.get("partNumber"));
          const count = Math.ceil(session.size / PART_SIZE);
          if (!Number.isInteger(number) || number < 1 || number > count) fail(400, "Invalid part number.");
          const expected = Math.min(PART_SIZE, session.size - (number - 1) * PART_SIZE);
          if (Number(request.headers.get("Content-Length")) !== expected) {
            fail(400, "Upload part length does not match the original file.");
          }
          if (await bucket.head(session.key)) fail(409, "Archive already saved. Refresh its status.");
          const data = await request.arrayBuffer();
          if (data.byteLength !== expected) fail(400, "Upload part was incomplete. Please resume.");
          if (number === 1 && !(data.byteLength >= 4 &&
              new Uint8Array(data)[0] === 0x50 && new Uint8Array(data)[1] === 0x4b)) {
            fail(400, "This does not look like a ZIP file.");
          }
          const upload = bucket.resumeMultipartUpload(session.key, session.uploadId);
          const part = await upload.uploadPart(number, data);
          const receipt = { partNumber: part.partNumber, etag: part.etag, size: expected };
          await bucket.put(`${SESSION_PREFIX}${session.fingerprint}/parts/${number}.json`,
            JSON.stringify(receipt), {
              httpMetadata: { contentType: "application/json" },
              customMetadata: {
                partNumber: String(number), etag: part.etag, size: String(expected),
              },
            });
          return json(receipt);
        }
        if (url.pathname === "/api/uploads/complete" && request.method === "POST") {
          const input = await readJson(request);
          const session = await loadSession(bucket, input.key, input.uploadId);
          const existing = await bucket.head(session.key);
          if (existing) {
            if (existing.size !== session.size) fail(409, "Archive size does not match.");
            return json({ key: session.key, size: existing.size, etag: existing.etag, completed: true });
          }
          const parts = await readParts(bucket, session);
          const count = Math.ceil(session.size / PART_SIZE);
          if (parts.length !== count || parts.some((part, i) =>
            part.partNumber !== i + 1 ||
            part.size !== Math.min(PART_SIZE, session.size - i * PART_SIZE))) {
            fail(409, "Some file pieces are missing. Resume the upload before finishing.");
          }
          const upload = bucket.resumeMultipartUpload(session.key, session.uploadId);
          await upload.complete(parts.map(({ partNumber, etag }) => ({ partNumber, etag })));
          const saved = await bucket.head(session.key);
          if (!saved || saved.size !== session.size) {
            fail(409, "Archive was not verified. Keep your original ZIP and refresh the status.");
          }
          return json({ key: session.key, size: saved.size, etag: saved.etag, completed: true });
        }
        return json({ error: "Not found." }, 404);
      } catch (error) {
        return json({
          error: error.status ? error.message : "Upload interrupted. Reselect the same ZIP to resume. Keep your original file.",
        }, error.status || 503);
      }
    },
  };
}

export default createArchiveWorker("");
