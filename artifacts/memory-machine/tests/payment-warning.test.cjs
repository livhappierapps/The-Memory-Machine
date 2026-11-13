const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { runInNewContext } = require("node:vm");
const ts = require("typescript");

function loadComponent(file, mocks, state = []) {
  let cursor = 0;
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(resolve(__dirname, "../src", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports,
    URLSearchParams,
    require(name) {
      if (name === "react") return {
        useState(initial) {
          const index = cursor++;
          if (!(index in state)) state[index] = initial;
          return [state[index], (value) => { state[index] = value; }];
        },
        useEffect() {}, useCallback: (fn) => fn,
      };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
      return mocks[name] ?? new Proxy({}, { get: (_, key) => key });
    },
  });
  return exports;
}

test("vault renders payment warning only after settings report a non-active status", () => {
  for (const paymentStatus of [undefined, "active", "overdue", "past_due"]) {
    const components = loadComponent("pages/vault.tsx", {
      "@clerk/react": { Show: "Show" },
      "@/contexts/profile-context": { useProfile: () => ({ activeProfileId: 1 }) },
      "@workspace/api-client-react": {
        getGetSettingsQueryKey: () => ["/api/settings"],
        useGetSettings(options) {
          assert.equal(options.query.refetchInterval, 60_000);
          assert.equal(options.query.refetchOnWindowFocus, true);
          return { data: paymentStatus === undefined ? undefined : { paymentStatus } };
        },
      },
    });
    const signedIn = components.default().props.children[1];
    const tree = signedIn.props.children.type();
    const banner = tree.props.warningBanner;
    if (paymentStatus === undefined || paymentStatus === "active") {
      assert.equal(banner, null);
    } else {
      assert.equal(banner.type, "PaymentWarningBanner");
      assert.equal(banner.props.paymentStatus, paymentStatus);
    }
  }
});

test("layout puts the payment warning immediately after the deletion warning", () => {
  const { AppLayout } = loadComponent("components/layout/app-layout.tsx", {
    wouter: { useLocation: () => ["/vault"], useSearch: () => "" },
    "@clerk/react": { useClerk: () => ({ signOut() {} }) },
  });
  const banner = { type: "payment-warning" };
  const tree = AppLayout({ children: "vault-content", warningBanner: banner });
  assert.equal(tree.props.children[0].type, "DeletionWarningBanner");
  assert.equal(tree.props.children[1], banner);
});

test("payment warning is hidden when active and can be dismissed when overdue", () => {
  const mocks = { "@/hooks/use-toast": { useToast: () => ({ toast() {} }) } };
  const file = "components/vault/deletion-warning-banner.tsx";
  assert.equal(loadComponent(file, mocks).PaymentWarningBanner({ paymentStatus: "active" }), null);
  const state = [];
  const banner = loadComponent(file, mocks, state).PaymentWarningBanner({ paymentStatus: "overdue" });
  const button = banner.props.children.props.children[2];
  assert.equal(button.props["aria-label"], "Dismiss");
  button.props.onClick();
  assert.equal(loadComponent(file, mocks, state).PaymentWarningBanner({ paymentStatus: "overdue" }), null);
});
