const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const config = require("../metro.config.js");
const root = path.resolve(__dirname, "../../..");
const blocked = (relative) =>
  config.resolver.blockList.some((rule) => rule.test(path.join(root, relative)));

test("Metro excludes transient API output, handoffs and internal workspace data", () => {
  for (const tree of ["artifacts/api-server/dist", "artifacts/api-server/dist/index.mjs", ".local/state", "handoffs/source.zip", "research/notes.md"]) {
    assert.equal(blocked(tree), true, tree);
  }
});

test("Metro still sees app source, shared libraries and runtime dependency dist folders", () => {
  for (const file of ["artifacts/memory-machine-mobile/app/index.tsx", "lib/api-client-react/src/index.ts", "node_modules/example/dist/index.js"]) {
    assert.equal(blocked(file), false, file);
  }
});
