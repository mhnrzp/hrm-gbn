// Apply supabase/migrations to the database in SUPABASE_DB_URL (.env.local), then regenerate TS types.
// Usage: pnpm db:push            (asks the CLI to confirm)
//        pnpm db:push --dry-run  (show pending migrations only)
import { config } from "dotenv";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

config({ path: ".env.local" });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("SUPABASE_DB_URL is not set in .env.local (see .env.example).");
  process.exit(1);
}

const extra = process.argv.slice(2);
const push = spawnSync("pnpm", ["exec", "supabase", "db", "push", "--db-url", dbUrl, ...extra], { stdio: "inherit", shell: true });
if (push.status !== 0 || extra.includes("--dry-run")) process.exit(push.status ?? 1);

const types = spawnSync("pnpm", ["exec", "supabase", "gen", "types", "typescript", "--db-url", dbUrl, "--schema", "public"], { encoding: "utf8", shell: true });
if (types.status !== 0) {
  console.error(types.stderr);
  process.exit(types.status ?? 1);
}
writeFileSync("lib/database.types.ts", types.stdout);
console.log("Types written to lib/database.types.ts");
