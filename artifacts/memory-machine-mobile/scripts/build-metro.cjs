const net = require("node:net");
const path = require("node:path");

function resolveRouterBundlePath(projectRoot, workspaceRoot) {
  const entry = require.resolve("expo-router/entry", { paths: [projectRoot] });
  return path.relative(workspaceRoot, entry).replace(/\.js$/, "").split(path.sep).join("/");
}

async function freeMetroPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function isMetroHealthy(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/status`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok && (await response.text()).trim() === "packager-status:running";
  } catch {
    return false;
  }
}

function getBuildPublishableKey(env) {
  const key = env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || env.CLERK_PUBLISHABLE_KEY;
  if (!key || !/^pk_(test|live)_/.test(key)) {
    throw new Error("Mobile build requires EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY or CLERK_PUBLISHABLE_KEY. Refusing to bundle a broken sign-in configuration.");
  }
  return key;
}

module.exports = { resolveRouterBundlePath, freeMetroPort, isMetroHealthy, getBuildPublishableKey };
