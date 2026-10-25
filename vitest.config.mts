import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } },
  test: {
    // unit = pure TS; db = migrations + RLS/RPC logic on in-process PGlite (no network).
    include: ["tests/unit/**/*.test.ts", "tests/db/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
