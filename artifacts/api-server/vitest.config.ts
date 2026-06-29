import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    include: ["src/__tests__/**/*.test.ts"],
    globals: false,
    env: {
      ENCRYPTION_ROOT_SECRET: "test-encryption-root-secret-for-vitest-only-32ch",
    },
  },
});
