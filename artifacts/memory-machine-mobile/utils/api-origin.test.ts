import assert from "node:assert/strict";
import test from "node:test";
import { apiOriginOrEmpty, resolveApiOrigin } from "./api-origin";

test("bare hosts and full HTTPS URLs resolve to the same API origin", () => {
  assert.equal(resolveApiOrigin("api.example.com"), "https://api.example.com");
  assert.equal(resolveApiOrigin("https://api.example.com/"), "https://api.example.com");
  assert.equal(resolveApiOrigin(" api.example.com "), "https://api.example.com");
});

test("missing and unsafe API addresses fail explicitly", () => {
  for (const value of [undefined, "", "http://example.com", "https://user:pass@example.com", "https://example.com/path", "https://example.com?token=no", "https://example.com/#fragment"]) {
    assert.throws(() => resolveApiOrigin(value));
  }
});

test("never produces a double scheme (https://https://)", () => {
  for (const v of ["https://the-memory-machine.replit.app", "the-memory-machine.replit.app"]) {
    assert.equal(apiOriginOrEmpty(v), "https://the-memory-machine.replit.app");
    assert.ok(!apiOriginOrEmpty(v).includes("https://https://"));
  }
});

test("apiOriginOrEmpty falls back to relative URLs instead of throwing", () => {
  assert.equal(apiOriginOrEmpty(undefined), "");
  assert.equal(apiOriginOrEmpty("http://insecure.example.com"), "");
});
