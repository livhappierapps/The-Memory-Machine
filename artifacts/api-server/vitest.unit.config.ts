import { defineConfig } from "vitest/config";

// Database-free regressions: do not inherit the live-DB global setup.
// These tests are also included by the default test/build command.
export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    include: ["src/__tests__/unit/**/*.test.ts"],
    globals: false,
    env: {
      ENCRYPTION_ROOT_SECRET: "test-encryption-root-secret-for-vitest-only-32ch",
    },
  },
});
