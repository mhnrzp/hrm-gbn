import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, unwrap } from "@/lib/errors";
import type { Member } from "@/lib/auth";

export type FeedItem = {
  type: "task" | "meeting" | "leave" | "availability";
  id: string;
  employee_id: string;
  start_at: string;
  end_at: string;
  title: string | null;
  status: string | null;
  meta: Record<string, unknown>;
};

export async function calendarFeed(db: SupabaseClient, from: string, to: string, employeeIds?: string[]) {
  return unwrap(await db.rpc("calendar_feed", { p_from: from, p_to: to, p_employee_ids: employeeIds ?? null })) as FeedItem[];
}

export type ScheduleConflict = {
  kind: "meeting_overlap" | "leave_task";
  event_id?: string;
  leave_request_id?: string;
  leave_status?: string;
  title?: string;
  user_id: string;
  full_name: string;
  start_at: string;
  end_at: string;
  items: { kind: string; id?: string; occurrence_id?: string; title: string | null; start_at?: string; end_at?: string; due_at?: string }[];
};

export async function scheduleConflicts(db: SupabaseClient, from: string, to: string) {
  return unwrap(await db.rpc("schedule_conflicts", { p_from: from, p_to: to })) as ScheduleConflict[];
}

/* ── Leave ── */

export type LeaveRow = {
  id: string;
  employee_id: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  days_count: number;
  status: string;
  reason_private: string;
  manager_comment: string | null;
  is_manager_override: boolean;
  created_at: string;
  reviewed_at: string | null;
  leave_types: { name: string; code: string } | null;
  employee: { full_name: string; avatar_path: string | null } | null;
};

const LEAVE_SELECT =
  "id, employee_id, start_at, end_at, all_day, days_count, status, reason_private, manager_comment, is_manager_override, created_at, reviewed_at, leave_types(name, code), employee:profiles!leave_requests_employee_id_fkey(full_name, avatar_path)";

/** RLS returns own requests for employees and the whole team for managers. */
export async function listLeaveRequests(db: SupabaseClient, q: { status?: string; employee_id?: string; limit?: number }) {
  let query = db.from("leave_requests").select(LEAVE_SELECT).order("created_at", { ascending: false }).limit(q.limit ?? 25);
  if (q.status) query = query.eq("status", q.status);
  if (q.employee_id) query = query.eq("employee_id", q.employee_id);
  return unwrap(await query) as unknown as LeaveRow[];
}

export async function getLeaveRequest(db: SupabaseClient, id: string) {
  const row = unwrap(await db.from("leave_requests").select(LEAVE_SELECT).eq("id", id).maybeSingle()) as unknown as LeaveRow | null;
  if (!row) throw new AppError("NOT_FOUND");
  const [conflicts, balance] = await Promise.all([
    db.rpc("check_availability", { p_user: row.employee_id, p_start: row.start_at, p_end: row.end_at }),
    db.rpc("leave_balance", { p_user: row.employee_id }),
  ]);
  return { ...row, busy: conflicts.data ?? null, balance: balance.data ?? null };
}

export async function submitLeave(db: SupabaseClient, member: Member, input: Record<string, unknown>) {
  return unwrap(await db.rpc("submit_leave", { p: { ...input, organization_id: member.orgId } }));
}

export async function reviewLeave(db: SupabaseClient, id: string, decision: "approve" | "reject", comment?: string) {
  return unwrap(await db.rpc("review_leave", { p_id: id, p_decision: decision, p_comment: comment ?? null }));
}

export async function updateLeave(db: SupabaseClient, id: string, patch: Record<string, unknown>) {
  return unwrap(await db.rpc("update_leave", { p_id: id, p: patch }));
}

export async function leaveTypes(db: SupabaseClient) {
  return unwrap(await db.from("leave_types").select("id, code, name, deducts_balance").eq("is_active", true).order("code")) as {
    id: string;
    code: string;
    name: string;
    deducts_balance: boolean;
  }[];
}

export type LeaveBalance = { quota_days: number; used_days: number; pending_days: number; remaining_days: number; jalali_year: number };

export async function leaveBalance(db: SupabaseClient, userId: string) {
  return unwrap(await db.rpc("leave_balance", { p_user: userId })) as LeaveBalance;
}

/* ── Availability ── */

export async function listAvailabilityRules(db: SupabaseClient, employeeId?: string) {
  let query = db
    .from("availability_rules")
    .select("id, employee_id, start_date, start_time, end_time, recurrence_type, weekdays, end_date, note")
    .eq("is_active", true)
    .order("start_date");
  if (employeeId) query = query.eq("employee_id", employeeId);
  return unwrap(await query);
}

export async function saveAvailability(db: SupabaseClient, member: Member, input: Record<string, unknown>, ruleId?: string) {
  return unwrap(await db.rpc("save_availability", { p: { ...input, organization_id: member.orgId }, p_rule: ruleId ?? null }));
}

export async function deleteAvailability(db: SupabaseClient, ruleId: string) {
  unwrap(await db.rpc("delete_availability", { p_rule: ruleId }));
  return { rule_id: ruleId, deleted: true };
}

export async function checkAvailability(db: SupabaseClient, userId: string, start: string, end: string) {
  return unwrap(await db.rpc("check_availability", { p_user: userId, p_start: start, p_end: end })) as {
    status: "approved_leave" | "already_scheduled_work" | "available" | "no_declared_availability";
    items: { kind: string; title: string | null; start_at: string; end_at: string }[];
  };
}

/* ── Meetings ── */

export type SaveEventResult = {
  saved: boolean;
  event_id?: string;
  conflicts: { user_id: string; full_name: string; items: { kind: string; title: string | null; start_at: string; end_at: string }[] }[];
  suggested?: { start_at: string; end_at: string } | null;
};

export async function saveEvent(db: SupabaseClient, member: Member, input: Record<string, unknown>, eventId?: string) {
  return unwrap(await db.rpc("save_event", { p: { ...input, organization_id: member.orgId }, p_event: eventId ?? null })) as SaveEventResult;
}

export async function cancelEvent(db: SupabaseClient, id: string) {
  unwrap(await db.rpc("cancel_event", { p_event: id }));
  return { event_id: id, cancelled: true };
}

export async function getEvent(db: SupabaseClient, id: string) {
  const row = unwrap(
    await db
      .from("calendar_events")
      .select(
        "id, title, description, location, start_at, end_at, organizer_id, is_cancelled, organizer:profiles!calendar_events_organizer_id_fkey(full_name), calendar_event_attendees(user_id, profiles(full_name, avatar_path))",
      )
      .eq("id", id)
      .maybeSingle(),
  );
  if (!row) throw new AppError("NOT_FOUND");
  const r = row as unknown as { start_at: string; end_at: string; id: string; calendar_event_attendees: { user_id: string }[] };
  const busy = await Promise.all(
    r.calendar_event_attendees.map(async (a) => {
      const res = await db.rpc("check_availability", { p_user: a.user_id, p_start: r.start_at, p_end: r.end_at });
      const items = ((res.data?.items ?? []) as { kind: string; id?: string }[]).filter((i) => !(i.kind === "meeting" && i.id === r.id));
      return { user_id: a.user_id, items };
    }),
  );
  return { ...(row as object), conflicts: busy.filter((b) => b.items.length > 0) };
}
