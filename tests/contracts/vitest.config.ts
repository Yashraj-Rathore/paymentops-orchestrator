import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/contracts/**/*.pact.spec.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000
  }
});
