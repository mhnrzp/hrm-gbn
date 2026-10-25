// Throwaway organisations on the dev project for live tests; everything is removed in teardown.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
export const liveConfigured = !!(url && anonKey && secret);

export const admin = () => createClient(url!, secret!, { auth: { persistSession: false } });
export const anon = () => createClient(url!, anonKey!, { auth: { persistSession: false } });

export type LiveUser = { id: string; email: string; client: SupabaseClient };
export type LiveOrg = { id: string; slug: string; manager: LiveUser; manager2: LiveUser; employees: LiveUser[]; users: LiveUser[] };

const run = Math.random().toString(36).slice(2, 8);

async function makeUser(org: string, label: string, role: "manager" | "employee"): Promise<LiveUser> {
  const a = admin();
  const email = `it-${run}-${label}@example.test`;
  const password = `It-${crypto.randomUUID()}`;
  const { data, error } = await a.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `IT ${label}` } });
  if (error || !data.user) throw error;
  const { error: mErr } = await a.from("organization_memberships").insert({ organization_id: org, user_id: data.user.id, role, status: "active", job_title: label });
  if (mErr) throw mErr;
  const client = anon();
  const { error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw sErr;
  return { id: data.user.id, email, client };
}

export async function createOrg(label: string): Promise<LiveOrg> {
  const slug = `it-${run}-${label}`;
  const { data, error } = await admin().from("organizations").insert({ name: `IT ${label}`, slug }).select("id").single();
  if (error) throw error;
  const manager = await makeUser(data.id, `${label}-m1`, "manager");
  const manager2 = await makeUser(data.id, `${label}-m2`, "manager");
  const employees = [await makeUser(data.id, `${label}-e1`, "employee"), await makeUser(data.id, `${label}-e2`, "employee")];
  return { id: data.id, slug, manager, manager2, employees, users: [manager, manager2, ...employees] };
}

const ORG_TABLES = [
  "notifications", "outbox_events", "attachments", "payment_records", "invoices", "invoice_series", "invoice_counters",
  "task_updates", "task_occurrence_assignees", "task_occurrences", "task_assignees", "tasks",
  "calendar_event_attendees", "calendar_events", "availability_occurrences", "availability_rules", "leave_requests",
  "member_preferences", "invitations", "audit_logs", "organization_memberships", "leave_types",
];

export async function destroyOrg(org: LiveOrg) {
  const a = admin();
  for (const t of ORG_TABLES) await a.from(t).delete().eq("organization_id", org.id);
  await a.from("organizations").delete().eq("id", org.id);
  for (const u of org.users) {
    await a.from("audit_logs").delete().eq("actor_user_id", u.id);
    await a.from("profile_private").delete().eq("user_id", u.id);
    await a.from("profiles").delete().eq("id", u.id);
    await a.auth.admin.deleteUser(u.id);
  }
}

export function code(err: unknown): string | undefined {
  return (err as { message?: string } | null)?.message;
}
