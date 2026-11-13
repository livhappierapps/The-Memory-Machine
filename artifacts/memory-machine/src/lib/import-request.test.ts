import test from "node:test";
import assert from "node:assert/strict";
import {
  getImportRequestError,
  makeImportRequestInit,
  requireImportAuthToken,
} from "./import-request";

test("multipart imports keep cookies and attach a Clerk bearer token", () => {
  const controller = new AbortController();
  const body = new FormData();
  const init = makeImportRequestInit(body, controller.signal, undefined, "clerk-session");

  assert.equal(init.method, "POST");
  assert.equal(init.credentials, "include");
  assert.equal(init.body, body);
  assert.equal(init.signal, controller.signal);
  assert.equal(new Headers(init.headers).get("authorization"), "Bearer clerk-session");
  assert.equal(new Headers(init.headers).has("content-type"), false);
});

test("JSON finalize requests include content type and Clerk bearer token", () => {
  const init = makeImportRequestInit(
    "{}",
    new AbortController().signal,
    "application/json",
    "clerk-session",
  );
  const headers = new Headers(init.headers);

  assert.equal(init.credentials, "include");
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("authorization"), "Bearer clerk-session");
});

test("unauthorized imports show sign-in recovery steps rather than a raw server error", () => {
  assert.match(getImportRequestError(401, "Unauthorized", "Upload failed"), /Refresh the page/);
  assert.match(getImportRequestError(401, "Unauthorized", "Upload failed"), /No memories were imported/);
});

test("imports stop before sending a chunk when Clerk has no session token", () => {
  assert.equal(requireImportAuthToken("clerk-session"), "clerk-session");
  assert.throws(() => requireImportAuthToken(null), /Refresh the page/);
  assert.throws(() => requireImportAuthToken(""), /Refresh the page/);
});

test("other import failures keep the server's actionable error", () => {
  assert.equal(getImportRequestError(413, "File is too large", "Upload failed"), "File is too large");
});
