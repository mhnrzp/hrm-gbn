// One-time setup: create the organisation and invite its first manager.
// Usage: pnpm bootstrap --name "گسترش بینش نوین" --slug gbn --email manager@example.com --manager "علی رضایی"
import { config } from "dotenv";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    slug: { type: "string" },
    email: { type: "string" },
    manager: { type: "string" },
    timezone: { type: "string", default: process.env.DEFAULT_ORGANIZATION_TIMEZONE ?? "Asia/Tehran" },
  },
});

const { name, slug, email, manager, timezone } = values;
if (!name || !slug || (email && !manager)) {
  console.error('Usage: pnpm bootstrap --name "<org name>" --slug <slug> [--email <manager email> --manager "<manager full name>"]');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
if (!url || !secret) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local");
  process.exit(1);
}

const admin = createClient(url, secret, { auth: { persistSession: false } });

async function main() {
  // Idempotent: reuse the organisation if the slug already exists.
  const existing = await admin.from("organizations").select("id").eq("slug", slug!).maybeSingle();
  if (existing.error) throw existing.error;
  let org = existing.data;
  if (!org) {
    const created = await admin.from("organizations").insert({ name, slug, timezone }).select("id").single();
    if (created.error) throw created.error;
    org = created.data;
    console.log(`Organisation ${slug} created (${org.id}).`);
  } else {
    console.log(`Organisation ${slug} already exists (${org.id}).`);
  }
  if (!email) {
    console.log("No --email given: no manager invited. Run again with --email/--manager to invite the first real manager.");
    return;
  }

  const { data: invite, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email!.toLowerCase(), {
    data: { full_name: manager },
    redirectTo: `${site}/auth/set-password`,
  });
  if (inviteError || !invite.user) throw inviteError ?? new Error("invite failed");
  const userId = invite.user.id;

  // First manager: no inviter exists yet, so write the rows directly (service role).
  await admin.from("profiles").update({ full_name: manager }).eq("id", userId).throwOnError();
  await admin.from("organization_memberships").insert({ organization_id: org.id, user_id: userId, role: "manager", status: "invited", job_title: "مدیر مجموعه" }).throwOnError();
  await admin.from("invitations").insert({ organization_id: org.id, user_id: userId, invited_email: email!.toLowerCase(), role: "manager" }).throwOnError();

  console.log(`Invitation email sent to ${email}.`);
}

main().catch((err) => {
  console.error("Bootstrap failed:", err.message ?? err);
  process.exit(1);
});
