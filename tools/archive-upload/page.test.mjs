import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const html = fs.readFileSync(new URL("./upload.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

async function selectWithStatus(reply) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      textContent: "", className: "", disabled: false, style: {}, listeners: {},
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute() {}, appendChild() {},
      addEventListener(name, fn) { this.listeners[name] = fn; },
    });
    return elements.get(id);
  }
  const cached = { key: "archives/test/export.zip", uploadId: "saved", completed: true, parts: [{ partNumber: 1, etag: "part-1" }] };
  const context = vm.createContext({
    crypto: webcrypto, TextEncoder, Uint8Array, Blob, URL, Response,
    document: {
      getElementById: element,
      createTextNode: (text) => ({ textContent: text }),
      createElement: () => element("signin-link"),
    },
    window: { crypto: webcrypto, addEventListener() {} },
    navigator: {},
    location: { origin: "https://test.invalid", href: "https://test.invalid/" },
    localStorage: { getItem: () => JSON.stringify(cached), setItem() {} },
    fetch: async () => {
      if (reply instanceof Error) throw reply;
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "Content-Type": "application/json" } });
    },
  });
  vm.runInContext(script, context);
  const file = {
    name: "export.zip", size: 8 * 1024 * 1024 + 22, lastModified: 1000,
    slice: (start, end = 8 * 1024 * 1024 + 22) => new Blob([new Uint8Array(end - start)]),
  };
  element("file").files = [file];
  await element("file").listeners.change();
  return element;
}

test("expired sign-in never displays cached completion as verified", async () => {
  const get = await selectWithStatus({ status: 401, body: { error: "Sign in" } });
  assert.equal(get("go").textContent, "Sign-in required");
  assert.equal(get("go").disabled, true);
  assert.doesNotMatch(get("pct").textContent, /100\.0%/);
  assert.match(get("status").textContent, /sign-in has expired/);
});

test("partial upload progress cannot round up to completed", async () => {
  const get = await selectWithStatus({
    status: 200, body: { parts: [{ partNumber: 1, etag: "one" }], completed: false },
  });
  assert.match(get("pct").textContent, /^99\.9%/);
  assert.equal(get("parts").textContent, "1/2 pieces");
  assert.equal(get("go").textContent, "Resume upload");
});

test("server-confirmed completion displays all pieces after reloading", async () => {
  const get = await selectWithStatus({ status: 200, body: { parts: [], completed: true } });
  assert.equal(get("go").textContent, "Upload complete");
  assert.match(get("pct").textContent, /^100\.0%/);
  assert.equal(get("parts").textContent, "2/2 pieces");
});

test("a network failure does not treat cached completion as verification", async () => {
  const get = await selectWithStatus(new Error("offline"));
  assert.equal(get("go").textContent, "Resume upload");
  assert.doesNotMatch(get("pct").textContent, /100\.0%/);
  assert.match(get("status").textContent, /Could not reach the server/);
});
