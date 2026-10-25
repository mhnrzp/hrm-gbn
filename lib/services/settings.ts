import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, unwrap } from "@/lib/errors";
import type { Member } from "@/lib/auth";

export type Preferences = {
  in_app_enabled: boolean;
  email_enabled: boolean;
  notify_leave_requests: boolean;
  notify_task_status: boolean;
  task_reminder_enabled: boolean;
  task_reminder_days: number;
  invoice_reminder_enabled: boolean;
  invoice_reminder_days: number;
  weekly_digest_enabled: boolean;
  compact_tables: boolean;
};

export type CompanySettings = {
  name: string;
  registration_code: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  timezone: string;
  week_start: number;
  weekend_days: number[];
  default_leave_quota_days: number;
};

const DEFAULT_PREFS: Preferences = {
  in_app_enabled: true,
  email_enabled: false,
  notify_leave_requests: true,
  notify_task_status: false,
  task_reminder_enabled: true,
  task_reminder_days: 1,
  invoice_reminder_enabled: true,
  invoice_reminder_days: 3,
  weekly_digest_enabled: false,
  compact_tables: true,
};

export async function getSettings(db: SupabaseClient, member: Member) {
  const [prefs, profile, priv, company, roleCounts] = await Promise.all([
    db.from("member_preferences").select("*").eq("organization_id", member.orgId).eq("user_id", member.userId).maybeSingle(),
    db.from("profiles").select("full_name, avatar_path").eq("id", member.userId).single(),
    db.from("profile_private").select("email, phone").eq("user_id", member.userId).single(),
    db.from("organizations").select("name, registration_code, email, phone, address, timezone, week_start, weekend_days, default_leave_quota_days").eq("id", member.orgId).single(),
    member.role === "manager" ? db.from("organization_memberships").select("role").eq("organization_id", member.orgId).eq("status", "active") : Promise.resolve({ data: null }),
  ]);
  const p = prefs.data as (Preferences & Record<string, unknown>) | null;
  const preferences = Object.fromEntries(Object.keys(DEFAULT_PREFS).map((k) => [k, p?.[k] ?? DEFAULT_PREFS[k as keyof Preferences]])) as Preferences;
  const counts = (roleCounts.data as { role: string }[] | null) ?? [];
  const prof = unwrap(profile) as { full_name: string; avatar_path: string | null };
  const pr = unwrap(priv) as { email: string; phone: string | null };
  const org = unwrap(company) as CompanySettings;
  return {
    role: member.role,
    profile: { full_name: prof.full_name, avatar_path: prof.avatar_path, email: pr.email, phone: pr.phone },
    preferences: member.role === "manager" ? preferences : { ...preferences, invoice_reminder_enabled: undefined, invoice_reminder_days: undefined },
    company: member.role === "manager" ? org : { name: org.name, timezone: org.timezone, week_start: org.week_start },
    access: member.role === "manager" ? { managers: counts.filter((c) => c.role === "manager").length, employees: counts.filter((c) => c.role === "employee").length } : undefined,
  };
}

export async function updateProfile(db: SupabaseClient, member: Member, patch: { full_name?: string; phone?: string; avatar_path?: string | null }) {
  if (patch.avatar_path && !patch.avatar_path.startsWith(`${member.orgId}/${member.userId}/`)) throw new AppError("FORBIDDEN", { field: "avatar_path" });
  if (patch.full_name !== undefined || patch.avatar_path !== undefined) {
    const p: Record<string, unknown> = {};
    if (patch.full_name !== undefined) p.full_name = patch.full_name;
    if (patch.avatar_path !== undefined) p.avatar_path = patch.avatar_path;
    unwrap(await db.from("profiles").update(p).eq("id", member.userId).select("id"));
  }
  if (patch.phone !== undefined) unwrap(await db.from("profile_private").update({ phone: patch.phone || null }).eq("user_id", member.userId).select("user_id"));
  return { updated: true };
}

export async function updatePreferences(db: SupabaseClient, member: Member, patch: Partial<Preferences>) {
  if (member.role !== "manager") {
    delete patch.invoice_reminder_enabled;
    delete patch.invoice_reminder_days;
  }
  unwrap(await db.from("member_preferences").upsert({ organization_id: member.orgId, user_id: member.userId, ...patch }, { onConflict: "organization_id,user_id" }).select("user_id"));
  return { updated: true };
}

export async function updateCompany(db: SupabaseClient, member: Member, patch: Partial<CompanySettings>) {
  const rows = unwrap(await db.from("organizations").update(patch).eq("id", member.orgId).select("id"));
  if (!rows?.length) throw new AppError("FORBIDDEN");
  return { updated: true };
}

export type AuditEntry = { id: number; action: string; entity_type: string; entity_id: string | null; actor_name: string; entity_label: string | null; changed_fields: Record<string, unknown>; created_at: string };

export async function listAuditLogs(db: SupabaseClient, opts: { limit: number; before?: number }) {
  const items = unwrap(await db.rpc("audit_feed", { p_limit: opts.limit, p_before: opts.before ?? null })) as AuditEntry[];
  return { items, next_before: items.length === opts.limit ? items[items.length - 1].id : null };
}
