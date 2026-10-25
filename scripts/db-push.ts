// Apply supabase/migrations to the database in SUPABASE_DB_URL (.env.local), then try to regenerate TS types.
// Usage: pnpm db:push            (applies pending migrations, no prompt)
//        pnpm db:push --dry-run  (show pending migrations only)
import { config } from "dotenv";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

config({ path: ".env.local" });
const raw = process.env.SUPABASE_DB_URL;
if (!raw) {
  console.error("SUPABASE_DB_URL is not set in .env.local (see .env.example).");
  process.exit(1);
}

/** The CLI needs a percent-encoded URL; dashboard passwords often contain @ # / etc. Re-encode user + password. */
function normalize(url: string) {
  const m = url.match(/^(postgres(?:ql)?:\/\/)([^:]+):(.*)@([^@]+)$/);
  if (!m) return url;
  const enc = (s: string) => {
    let decoded = s;
    try {
      decoded = decodeURIComponent(s);
    } catch {
      /* already raw */
    }
    return encodeURIComponent(decoded);
  };
  return `${m[1]}${enc(m[2])}:${enc(m[3])}@${m[4]}`;
}
const dbUrl = normalize(raw);

const extra = process.argv.slice(2);
const push = spawnSync("pnpm", ["exec", "supabase", "db", "push", "--db-url", `"${dbUrl}"`, "--yes", ...extra], { stdio: "inherit", shell: true });
if (push.status !== 0 || extra.includes("--dry-run")) process.exit(push.status ?? 1);

const types = spawnSync("pnpm", ["exec", "supabase", "gen", "types", "typescript", "--db-url", `"${dbUrl}"`, "--schema", "public"], { encoding: "utf8", shell: true });
if (types.status === 0 && types.stdout.includes("export type")) {
  writeFileSync("lib/database.types.ts", types.stdout);
  console.log("Types written to lib/database.types.ts");
} else {
  // Type generation may need Docker on some CLI versions; the app does not depend on the generated file.
  console.warn("Skipped type generation:", (types.stderr || "").split("\n")[0]);
}
