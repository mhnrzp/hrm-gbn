import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, unwrap } from "@/lib/errors";
import type { Member } from "@/lib/auth";
import type { BoardQuery, CreateTaskInput } from "@/lib/validation/tasks";

export type BoardAssignee = { user_id: string; full_name: string; avatar_path: string | null; progress_percent: number; progress_status: string };

export type BoardRow = {
  occurrence_id: string;
  task_id: string;
  title: string;
  description: string;
  priority: "normal" | "important" | "urgent";
  assignment_mode: "named" | "team_pool";
  recurrence_type: string;
  status: "todo" | "in_progress" | "completed" | "cancelled";
  is_overdue: boolean;
  due_at: string;
  scheduled_start_at: string | null;
  claimed_by: string | null;
  assignees: BoardAssignee[];
  progress_percent: number;
  total_count: number;
};

function boardArgs(q: Partial<BoardQuery>) {
  const limit = q.limit ?? 10;
  return {
    p_status: q.status ?? null,
    p_assignee: q.assignee ?? null,
    p_priority: q.priority ?? null,
    p_due: q.due ?? null,
    p_q: q.q || null,
    p_limit: limit,
    p_offset: ((q.page ?? 1) - 1) * limit,
  };
}

export async function listBoard(db: SupabaseClient, q: Partial<BoardQuery>) {
  const rows = unwrap(await db.rpc("task_board", boardArgs(q))) as BoardRow[];
  return { rows, total: Number(rows[0]?.total_count ?? 0) };
}

/** Counts for the status chips (همه / انجام‌نشده / در حال انجام / تکمیل‌شده). */
export async function boardCounts(db: SupabaseClient) {
  const count = async (status?: BoardQuery["status"]) => (await listBoard(db, { status, limit: 1 })).total;
  const [all, todo, inProgress, completed, overdue] = await Promise.all([count(), count("todo"), count("in_progress"), count("completed"), count("overdue")]);
  return { all, todo, in_progress: inProgress, completed, overdue };
}

type OccurrenceDetail = {
  id: string;
  task_id: string;
  status: string;
  due_at: string;
  scheduled_start_at: string | null;
  claimed_by: string | null;
  completed_at: string | null;
  completed_by: string | null;
  tasks: {
    title: string;
    description: string;
    priority: string;
    assignment_mode: string;
    completion_policy: string;
    recurrence_type: string;
    recurrence_interval: number;
    recurrence_end_date: string | null;
    due_date: string;
    due_time: string;
    start_date: string | null;
    start_time: string | null;
    is_active: boolean;
    created_by: string;
    creator: { full_name: string } | null;
  };
  task_occurrence_assignees: { user_id: string; progress_percent: number; progress_status: string; profiles: { full_name: string; avatar_path: string | null } | null }[];
  task_updates: { id: string; update_type: string; body: string | null; metadata: Record<string, unknown> | null; created_at: string; author: { full_name: string; avatar_path: string | null } | null; author_id: string }[];
};

export async function getOccurrence(db: SupabaseClient, id: string) {
  const row = unwrap(
    await db
      .from("task_occurrences")
      .select(
        `id, task_id, status, due_at, scheduled_start_at, claimed_by, completed_at, completed_by,
         tasks!inner(title, description, priority, assignment_mode, completion_policy, recurrence_type, recurrence_interval, recurrence_end_date,
                     due_date, due_time, start_date, start_time, is_active, created_by, creator:profiles!tasks_created_by_fkey(full_name)),
         task_occurrence_assignees(user_id, progress_percent, progress_status, profiles(full_name, avatar_path)),
         task_updates(id, update_type, body, metadata, created_at, author_id, author:profiles!task_updates_author_id_fkey(full_name, avatar_path))`,
      )
      .eq("id", id)
      .order("created_at", { referencedTable: "task_updates", ascending: true })
      .maybeSingle(),
  ) as OccurrenceDetail | null;
  if (!row) throw new AppError("NOT_FOUND");
  return {
    ...row,
    is_overdue: new Date(row.due_at) < new Date() && !["completed", "cancelled"].includes(row.status),
    progress_percent: row.task_occurrence_assignees.length
      ? Math.round(row.task_occurrence_assignees.reduce((s, a) => s + a.progress_percent, 0) / row.task_occurrence_assignees.length)
      : 0,
  };
}

export async function createTask(db: SupabaseClient, member: Member, input: CreateTaskInput) {
  return unwrap(await db.rpc("create_task", { p: { ...input, organization_id: member.orgId } })) as { task_id: string; occurrence_id: string; warnings: unknown[] };
}

export async function updateTaskSeries(db: SupabaseClient, taskId: string, patch: Record<string, unknown>) {
  return unwrap(await db.rpc("update_task_series", { p_task: taskId, p: patch }));
}

export async function archiveTask(db: SupabaseClient, taskId: string) {
  unwrap(await db.rpc("archive_task", { p_task: taskId }));
  return { task_id: taskId, archived: true };
}

export async function getTask(db: SupabaseClient, taskId: string) {
  const row = unwrap(
    await db
      .from("tasks")
      .select("id, title, description, priority, assignment_mode, completion_policy, due_date, due_time, start_date, start_time, recurrence_type, recurrence_interval, recurrence_days_of_week, recurrence_end_date, is_active, archived_at, created_by, task_assignees(user_id)")
      .eq("id", taskId)
      .maybeSingle(),
  );
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

export async function listTasks(db: SupabaseClient, opts: { includeArchived?: boolean; limit: number; cursor?: string }) {
  let query = db
    .from("tasks")
    .select("id, title, priority, assignment_mode, recurrence_type, due_date, due_time, is_active, created_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(opts.limit + 1);
  if (!opts.includeArchived) query = query.eq("is_active", true);
  if (opts.cursor) query = query.lt("created_at", opts.cursor);
  const rows = unwrap(await query) as { created_at: string }[];
  const hasMore = rows.length > opts.limit;
  const page = rows.slice(0, opts.limit);
  return { items: page, next_cursor: hasMore ? page[page.length - 1].created_at : null };
}

export const occurrenceActions = {
  claim: async (db: SupabaseClient, id: string) => unwrap(await db.rpc("claim_occurrence", { p_occurrence: id })),
  complete: async (db: SupabaseClient, id: string, note?: string) => ({
    status: unwrap(await db.rpc("complete_occurrence", { p_occurrence: id, p_note: note ?? null })) as string,
  }),
  progress: async (db: SupabaseClient, id: string, p: { progress_percent?: number; status?: string; note?: string }) => ({
    status: unwrap(
      await db.rpc("update_my_progress", { p_occurrence: id, p_percent: p.progress_percent ?? null, p_status: p.status ?? null, p_note: p.note ?? null }),
    ) as string,
  }),
  manage: async (db: SupabaseClient, id: string, patch: Record<string, unknown>) => ({
    status: unwrap(await db.rpc("manage_occurrence", { p_occurrence: id, p: patch })) as string,
  }),
  comment: async (db: SupabaseClient, id: string, body: string) => ({
    id: unwrap(await db.rpc("add_task_comment", { p_occurrence: id, p_body: body })) as string,
  }),
};
