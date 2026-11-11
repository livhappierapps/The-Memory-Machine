import { defineConfig } from "vitest/config";

// The live server uses its real encryption secret. Do not inherit the unit
// config's test-only ENCRYPTION_ROOT_SECRET or mock authentication here.
export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    include: ["src/__tests__/integration/**/*.integration.ts"],
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
