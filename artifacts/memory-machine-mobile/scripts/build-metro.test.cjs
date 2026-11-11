const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { resolveRouterBundlePath, freeMetroPort, isMetroHealthy, getBuildPublishableKey } = require("./build-metro.cjs");

test("aliases only the public Clerk key and refuses to ship missing or private credentials", () => {
  assert.equal(getBuildPublishableKey({ CLERK_PUBLISHABLE_KEY: "pk_test_fixture" }), "pk_test_fixture");
  assert.equal(getBuildPublishableKey({
    CLERK_PUBLISHABLE_KEY: "pk_test_fallback", EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_fixture",
  }), "pk_live_fixture");
  assert.throws(() => getBuildPublishableKey({ CLERK_SECRET_KEY: "sk_test_fixture" }), /Mobile build requires/);
  assert.throws(() => getBuildPublishableKey({ CLERK_PUBLISHABLE_KEY: "sk_test_fixture" }), /Mobile build requires/);
});

test("resolves Expo Router's real installed path instead of assuming app-local node_modules", () => {
  const project = path.resolve(__dirname, "..");
  const workspace = path.resolve(project, "../..");
  const entry = resolveRouterBundlePath(project, workspace);
  assert.equal(fs.existsSync(path.join(workspace, `${entry}.js`)), true);
  assert.equal(entry.includes("\\"), false);
});

test("allocates a free port and refuses a normal web server's successful HTML status", async () => {
  const port = await freeMetroPort();
  let body = "<html>Not Metro</html>";
  const server = http.createServer((_req, res) => { res.end(body); });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  try {
    assert.equal(await isMetroHealthy(port), false);
    body = "packager-status:running";
    assert.equal(await isMetroHealthy(port), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(await isMetroHealthy(port), false);
});
