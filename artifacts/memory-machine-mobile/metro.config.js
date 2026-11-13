const path = require("path");
const Module = require("module");

// pnpm's hoisted workspace keeps Expo inside this app while Metro config is
// shared at the workspace root. Make the local Expo peer resolvable to Metro.
const appNodeModules = path.join(__dirname, "node_modules");
process.env.NODE_PATH = [appNodeModules, process.env.NODE_PATH]
  .filter(Boolean)
  .join(path.delimiter);
Module._initPaths();

const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// Metro scans the monorepo. API builds replace dist/ atomically; watching that
// transient directory can crash Metro with ENOENT during a backend restart.
// Keep runtime dependencies visible, but skip unrelated outputs and archives.
const workspaceRoot = path.resolve(__dirname, "../..");
const excludedTrees = [
  ".git", ".local", ".cache", ".agents", "handoffs", "exports",
  "generated-artifacts", "research", "docs/harvest",
  "artifacts/api-server/dist",
  "artifacts/memory-machine/dist",
  "artifacts/memory-machine-mobile/static-build",
];
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exclusions = excludedTrees.map((tree) => {
  const absolute = path.resolve(workspaceRoot, tree);
  return new RegExp(`^${escapeRegex(absolute)}(?:[/\\\\]|$)`);
});
const existing = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
  ...exclusions,
];

module.exports = config;
