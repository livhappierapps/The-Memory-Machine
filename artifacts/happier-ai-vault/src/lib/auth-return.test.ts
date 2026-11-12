import test from "node:test";
import assert from "node:assert/strict";
import { getConsentReturnUrl } from "./auth-return";

const origin = "https://memory.example";
const searchFor = (url: string) => `?${new URLSearchParams({ redirect_url: url })}`;

test("preserves the complete local consent request through sign-in", () => {
  const url = `${origin}/oauth/authorize?client_id=grok&state=return-state&code_challenge=abc`;
  assert.equal(getConsentReturnUrl(searchFor(url), origin, ""), url);
});

test("supports an artifact base path and relative consent URLs", () => {
  assert.equal(
    getConsentReturnUrl(searchFor("/memory/oauth/authorize?state=ok"), origin, "/memory"),
    `${origin}/memory/oauth/authorize?state=ok`,
  );
});

test("does not turn sign-in into an open redirect", () => {
  for (const url of [
    "https://attacker.example/oauth/authorize",
    "//attacker.example/oauth/authorize",
    "javascript:alert(1)",
    `${origin}/settings`,
    "https://user:password@memory.example/oauth/authorize",
  ]) {
    assert.equal(getConsentReturnUrl(searchFor(url), origin, ""), undefined);
  }
});

test("normal sign-in has no forced consent return", () => {
  assert.equal(getConsentReturnUrl("", origin, ""), undefined);
});
