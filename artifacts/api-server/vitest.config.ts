import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    include: ["src/__tests__/**/*.test.ts"],
    globals: false,
  },
});
