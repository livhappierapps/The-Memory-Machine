const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { runInNewContext } = require("node:vm");
const ts = require("typescript");
const TEST_NOW = Date.parse("2026-10-09T12:00:00.000Z");

// Render the actual components with isolated hooks. No auth, network or paid services.
function harness(mobile, initialNotes = []) {
  const slots = [];
  let cursor = 0;
  let notes = initialNotes;
  let search = "view=notes";
  let queries = [];
  let now = TEST_NOW;
  class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => {
        slots[index] = typeof value === "function" ? value(slots[index]) : value;
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback(callback) { cursor++; return callback; },
    useEffect() { cursor++; },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const exports = {};
  const sourcePath = mobile
    ? "../../memory-machine-mobile/app/(tabs)/vault.tsx"
    : "../src/components/vault/sidebar.tsx";
  runInNewContext(ts.transpileModule(readFileSync(resolve(__dirname, sourcePath), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, {
    exports, URLSearchParams, Date: TestDate,
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
      if (name === "@workspace/api-client-react") return {
        useListThreads(params, options) {
          queries.push({ params, options });
          return {
            data: mobile && params.source === "mcp" ? notes : [],
            isLoading: false, isRefetching: false, dataUpdatedAt: 1, refetch() {},
          };
        },
        getListThreadsQueryKey: (params) => ["/api/threads", params],
        getGetStatsQueryKey: () => ["/api/stats"],
        useListProfiles: () => ({ data: [{ id: 1 }] }),
        useCreateThread: () => ({ isPending: false, mutate() {} }),
        useUpdateThread: () => ({ mutate() {}, mutateAsync() {} }),
      };
      if (name === "react-native") return new Proxy({
        Platform: { OS: "ios" },
        StyleSheet: { create: (styles) => styles, hairlineWidth: 1, absoluteFill: {} },
        Animated: { Value: class {}, View: "AnimatedView" },
      }, { get: (target, key) => target[key] ?? key });
      if (name === "@clerk/expo") return { useAuth: () => ({ signOut() {}, getToken() {} }) };
      if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 20 }) };
      if (name === "@/hooks/useColors") return { useColors: () => ({
        background: "#fff", primary: "#0aa", foreground: "#222", mutedForeground: "#666", border: "#ddd",
      }) };
      if (name.includes("ProfileContext") || name.includes("profile-context")) return {
        useProfile: () => ({ activeProfile: { id: 1, name: "Default" }, activeProfileId: 1, setActiveProfile() {} }),
      };
      if (name.includes("IncomingShareContext")) return {
        useIncomingShareContext: () => ({ incomingFile: null, clearIncoming() {} }),
      };
      if (name.includes("ImportContext")) return { useImport: () => ({ phase: "idle", result: null }) };
      if (name === "@tanstack/react-query") return { useQueryClient: () => ({ invalidateQueries() {} }) };
      if (name === "wouter") return {
        useSearch: () => search,
        useLocation: () => ["/vault", (url) => { search = url.split("?")[1] ?? ""; }],
      };
      return new Proxy({}, { get: (_, key) => key });
    },
    process: { env: {} },
    fetch() { throw new Error("Filter test must never make network requests"); },
  });
  return {
    setNotes(value) { notes = value; },
    setNow(value) { now = value; },
    render() {
      cursor = 0;
      queries = [];
      const tree = mobile ? exports.default() : exports.Sidebar({ activeThreadId: null, onSelectThread() {} });
      const nodes = [];
      function visit(node) {
        if (!node || typeof node !== "object") return;
        nodes.push(node);
        for (const child of [node.props?.children, node.props?.ListHeaderComponent].flat(Infinity)) visit(child);
      }
      visit(tree);
      return { nodes, queries, hookCount: cursor };
    },
  };
}

const memories = (count, pinned = [1, 3]) => Array.from({ length: count }, (_, index) => ({
  id: index + 1, title: `note-${index + 1}`, pinned: pinned.includes(index + 1), createdAt: "2026-10-01",
}));
const toggle = (render) => render.nodes.find((node) => node.props?.accessibilityRole === "switch");
const recentToggle = (render) => render.nodes.find((node) => node.props?.accessibilityLabel === "Last 7 days");
const titles = (render) => render.nodes
  .filter((node) => node.type === "Text" && typeof node.props?.children === "string" && node.props.children.startsWith("note-"))
  .map((node) => node.props.children);

test("mobile only offers the pinned filter once there are more than five Leo memories", () => {
  const app = harness(true);
  app.setNotes(undefined);
  const loading = app.render();
  assert.equal(toggle(loading), undefined);
  app.setNotes(memories(5));
  const five = app.render();
  assert.equal(toggle(five), undefined);
  assert.equal(five.hookCount, loading.hookCount);
  app.setNotes(memories(6));
  assert.equal(toggle(app.render()).props.accessibilityState.checked, false);
});

test("mobile pinned switch filters and restores rows without collapsing the section", () => {
  const app = harness(true, memories(6));
  const before = app.render();
  assert.equal(titles(before).length, 6);
  toggle(before).props.onPress();
  const filtered = app.render();
  assert.deepEqual(titles(filtered), ["note-1", "note-3"]);
  assert.equal(toggle(filtered).props.accessibilityState.checked, true);
  assert.equal(filtered.hookCount, before.hookCount);
  toggle(filtered).props.onPress();
  assert.equal(titles(app.render()).length, 6);
});

test("mobile empty pinned results explain how to recover and keep the switch visible", () => {
  const app = harness(true, memories(6, []));
  toggle(app.render()).props.onPress();
  let filtered = app.render();
  assert.equal(titles(filtered).length, 0);
  assert.ok(filtered.nodes.some((node) => node.props?.children?.includes?.("No pinned Leo memories yet")));
  app.setNotes(memories(1, []));
  filtered = app.render();
  assert.ok(toggle(filtered));
  toggle(filtered).props.onPress();
  assert.deepEqual(titles(app.render()), ["note-1"]);
});

test("mobile applies the active filter to newly synced memories", () => {
  const app = harness(true, memories(6));
  const initial = app.render();
  const { params, options } = initial.queries.find((query) => query.params.source === "mcp");
  assert.equal(options.query.queryKey[1], params);
  assert.equal(options.query.refetchInterval, 30_000);
  toggle(initial).props.onPress();
  app.setNotes(memories(7, [2, 7]));
  assert.deepEqual(titles(app.render()), ["note-2", "note-7"]);
});

test("mobile collapse and pinned filter remain independent", () => {
  const app = harness(true, memories(6));
  toggle(app.render()).props.onPress();
  const filtered = app.render();
  const header = filtered.nodes.find((node) => node.props?.accessibilityLabel === "Leo Memories");
  header.props.onPress();
  const collapsed = app.render();
  assert.equal(titles(collapsed).length, 0);
  assert.equal(toggle(collapsed).props.accessibilityState.checked, true);
  collapsed.nodes.find((node) => node.props?.accessibilityLabel === "Leo Memories").props.onPress();
  assert.deepEqual(titles(app.render()), ["note-1", "note-3"]);
});

const datedMemories = () => memories(7, [1, 2, 3, 6, 7]).map((memory, index) => ({
  ...memory,
  createdAt: [
    "2026-10-01T00:00:00.000Z",
    "2026-10-02T12:00:00.000Z",
    "2026-10-02T11:59:59.999Z",
    "2026-10-09T11:59:00.000Z",
    "2026-10-09T12:00:00.001Z",
    "invalid-date",
    "2026-10-09T12:00:00.000Z",
  ][index],
}));

test("mobile Last 7 days uses an inclusive rolling window and excludes future or invalid dates", () => {
  const app = harness(true, datedMemories());
  recentToggle(app.render()).props.onPress();
  const recent = app.render();
  assert.equal(recentToggle(recent).props.accessibilityState.checked, true);
  assert.deepEqual(titles(recent), ["note-2", "note-4", "note-7"]);
});

test("mobile switches between all, pinned, recent and combined results", () => {
  const app = harness(true, datedMemories());
  assert.equal(titles(app.render()).length, 7);
  toggle(app.render()).props.onPress();
  assert.deepEqual(titles(app.render()), ["note-1", "note-2", "note-3", "note-6", "note-7"]);
  recentToggle(app.render()).props.onPress();
  assert.deepEqual(titles(app.render()), ["note-2", "note-7"]);
  toggle(app.render()).props.onPress();
  assert.deepEqual(titles(app.render()), ["note-2", "note-4", "note-7"]);
  recentToggle(app.render()).props.onPress();
  assert.equal(titles(app.render()).length, 7);
});

test("mobile recent filtering follows syncs and the advancing clock, with empty-result recovery", () => {
  const app = harness(true, memories(6));
  recentToggle(app.render()).props.onPress();
  assert.equal(titles(app.render()).length, 0);
  app.setNotes(datedMemories());
  assert.deepEqual(titles(app.render()), ["note-2", "note-4", "note-7"]);
  app.setNow(TEST_NOW + 8 * 24 * 60 * 60 * 1000);
  app.setNotes(datedMemories().slice(0, 1));
  const empty = app.render();
  assert.equal(titles(empty).length, 0);
  assert.ok(empty.nodes.some((node) => node.props?.children?.includes?.("No Leo memories from the last 7 days")));
  recentToggle(empty).props.onPress();
  assert.deepEqual(titles(app.render()), ["note-1"]);
});

function openDateFilters(app) {
  app.render().nodes.find((node) => node.props?.title === "Date filters").props.onClick();
  return app.render().nodes.filter((node) => node.props?.type === "date");
}

test("web date bounds apply to the mcp source and its cache key while polling continues", () => {
  const app = harness(false);
  const inputs = openDateFilters(app);
  inputs[0].props.onChange({ target: { value: "2026-10-01" } });
  inputs[1].props.onChange({ target: { value: "2026-10-09" } });
  const { params, options } = app.render().queries[0];
  assert.equal(params.source, "mcp");
  assert.equal(params.from, "2026-10-01");
  assert.equal(params.to, "2026-10-09");
  assert.equal(params.profileId, 1);
  assert.equal(params.archived, false);
  assert.equal(options.query.refetchInterval, 30_000);
  assert.equal(options.query.queryKey[1], params);
});

test("web clear-all removes date constraints without changing the Leo Memories source", () => {
  const app = harness(false);
  openDateFilters(app)[0].props.onChange({ target: { value: "2026-10-01" } });
  app.render().nodes.find((node) => node.type === "button" &&
    JSON.stringify(node.props.children).includes("Clear all")).props.onClick();
  const { params } = app.render().queries[0];
  assert.equal(params.source, "mcp");
  assert.equal(params.from, undefined);
  assert.equal(params.to, undefined);
});

test("web date constraints survive switching between Memories and Leo Memories", () => {
  const app = harness(false);
  openDateFilters(app)[1].props.onChange({ target: { value: "2026-10-09" } });
  app.render().nodes.find((node) => node.type === "Button" && node.props.children === "Memories").props.onClick();
  let query = app.render().queries[0];
  assert.equal(query.params.source, "chat");
  assert.equal(query.params.to, "2026-10-09");
  app.render().nodes.find((node) => node.type === "Button" &&
    [node.props.children].flat().includes("Leo Memories")).props.onClick();
  query = app.render().queries[0];
  assert.equal(query.params.source, "mcp");
  assert.equal(query.params.to, "2026-10-09");
});
