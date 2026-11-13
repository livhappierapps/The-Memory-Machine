const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { runInNewContext } = require("node:vm");
const ts = require("typescript");

// Evaluate the component with isolated hooks, without auth or destructive requests.
function createChatAreaHarness(ageInDays) {
  const state = [];
  let cursor = 0;
  let isLoading = false;
  const thread = {
    title: "Test vault", model: "grok", archived: false,
    createdAt: new Date(Date.now() - ageInDays * 86_400_000).toISOString(),
  };
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  const source = readFileSync(resolve(__dirname, "../src/components/vault/chat-area.tsx"), "utf8");
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports,
    require(name) {
      if (name === "react") return {
        useState(initial) {
          const index = cursor++;
          if (!(index in state)) state[index] = initial;
          return [state[index], (value) => { state[index] = value; }];
        },
        useRef: () => { cursor++; return { current: null }; },
        useEffect() { cursor++; },
      };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
      if (name === "@workspace/api-client-react") return new Proxy({
        useGetThread: () => { cursor++; return { data: isLoading ? undefined : thread, isLoading }; },
        useGetThreadMessages: () => { cursor++; return { data: isLoading ? undefined : [], isLoading }; },
        useGetMemoryPreview: () => { cursor++; return { data: { sources: [] } }; },
        useUpdateThread: () => { cursor++; return { mutate() {} }; },
      }, { get: (target, key) => target[key] ?? (() => []) });
      if (name === "@/hooks/use-chat-stream") return {
        useChatStream: () => { cursor++; return { memorySources: [], isStreaming: false }; },
      };
      if (name === "@tanstack/react-query") return { useQueryClient: () => { cursor++; return {}; } };
      return new Proxy({}, { get: (_, key) => key });
    },
    fetch() { throw new Error("Header must not call a raw deletion API"); },
  });

  return {
    render(loading = false) {
      isLoading = loading;
      cursor = 0;
      const tree = exports.ChatArea({ threadId: 42 });
      const hookCount = cursor;
      const nodes = [];
      function visit(node) {
        if (!node || typeof node !== "object") return;
        nodes.push(node);
        for (const child of [node.props?.children].flat(Infinity)) visit(child);
      }
      visit(tree);
      return { state, nodes, hookCount };
    },
  };
}

function renderHeader(ageInDays) {
  return createChatAreaHarness(ageInDays).render();
}

test("recent vault deletion is disabled with a visible lock explanation", () => {
  const { nodes } = renderHeader(10);
  const item = nodes.find(node => node.type === "DropdownMenuItem" &&
    [node.props.children].flat().includes(" Delete Vault"));
  assert.ok(item);
  assert.equal(item.props.disabled, true);
  assert.equal(item.props.onClick, undefined);
  const explanation = nodes.find(node => node.type === "p" &&
    JSON.stringify(node.props.children).includes("protected from deletion for 30 days"));
  assert.ok(explanation);
  assert.ok([explanation.props.children].flat().includes(20));
});

test("eligible vault deletion opens the protected dialog rather than deleting", () => {
  const { nodes, state } = renderHeader(31);
  const item = nodes.find(node => node.type === "DropdownMenuItem" &&
    [node.props.children].flat().includes(" Delete Vault"));
  assert.ok(item);
  assert.notEqual(item.props.disabled, true);
  item.props.onClick();
  assert.equal(state.at(-1), true);
});

test("keeps the same hook order while a new memory loads", () => {
  const harness = createChatAreaHarness(1);
  const loading = harness.render(true);
  const loaded = harness.render(false);

  assert.equal(loaded.hookCount, loading.hookCount);
});
