const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { mkdtemp, writeFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");

const consumerRequire = createRequire(require.resolve("@istanbuljs/load-nyc-config"));
const { loadNycConfig } = require("@istanbuljs/load-nyc-config");

test("NYC resolves the maintained YAML parser without sprintf-js", () => {
  assert.match(consumerRequire("js-yaml/package.json").version, /^4\./);
  assert.throws(() => consumerRequire.resolve("sprintf-js"), { code: "MODULE_NOT_FOUND" });
});

test("NYC loads YAML configs, extended configs, arrays and scalar options", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nyc-yaml-security-"));
  try {
    await writeFile(path.join(cwd, "package.json"), '{"private":true}');
    await writeFile(path.join(cwd, "base.yml"), "all: true\nexclude:\n  - fixtures/**\n");
    await writeFile(path.join(cwd, ".nycrc.yml"),
      "extends: ./base.yml\ncheck-coverage: true\nlines: 85\nextension: .ts\ninclude:\n  - src/**/*.ts\n");
    const config = await loadNycConfig({ cwd });
    assert.equal(config.all, true);
    assert.equal(config.checkCoverage, true);
    assert.equal(config.lines, 85);
    assert.deepEqual(config.extension, [".ts"]);
    assert.deepEqual(config.include, ["src/**/*.ts"]);
    assert.deepEqual(config.exclude, ["fixtures/**"]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("NYC rejects executable YAML tags", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nyc-yaml-security-"));
  try {
    await writeFile(path.join(cwd, "package.json"), '{"private":true}');
    await writeFile(path.join(cwd, ".nycrc.yml"), 'payload: !!js/function "function () { return 1; }"');
    await assert.rejects(loadNycConfig({ cwd }), /unknown tag/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
