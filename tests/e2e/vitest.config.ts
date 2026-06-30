import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["tests/e2e/global-setup.ts"],
    hookTimeout: 300_000,
    include: ["tests/e2e/**/*.e2e.spec.ts"],
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true
      }
    },
    sequence: {
      concurrent: false
    },
    testTimeout: 120_000
  }
});
