/**
 * Vitest config for smoke tests — runs against the real embedding API.
 *
 * Excluded from the normal `pnpm test` run (vitest.config.ts only includes
 * src/__tests__/**\/*.test.ts). Run manually or in CI:
 *
 *   EMBEDDING_API_KEY=sk-... pnpm --filter @workspace/api-server test:smoke
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    include: ["src/__tests__/smoke/**/*.smoke.ts"],
    globals: false,
    // Smoke tests hit a real network endpoint; give them a generous timeout.
    testTimeout: 30_000,
    env: {
      ENCRYPTION_ROOT_SECRET: "test-encryption-root-secret-for-vitest-only-32ch",
    },
  },
});
