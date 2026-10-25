import { defineConfig } from "vitest/config";
import { config } from "dotenv";

config({ path: ".env.local" });

// Live tests against the Supabase dev project: real Auth, PostgREST, RLS and true concurrency.
export default defineConfig({
  resolve: { alias: { "@": new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1") } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
