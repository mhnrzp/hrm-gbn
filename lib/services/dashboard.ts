import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Member } from "@/lib/auth";
import { addDays, localMidnight, weekDays } from "@/lib/calendar-dates";
import { localIsoDate } from "@/lib/format";
import { boardCounts, listBoard, type BoardRow } from "./tasks";
import { calendarFeed } from "./calendar";
import { invoiceSummary, listInvoices } from "./invoices";
import { listNotifications } from "./notifications";
import { listMemberOptions } from "./team";

const PRIORITY_RANK: Record<string, number> = { urgent: 0, important: 1, normal: 2 };

/**
 * Role-specific dashboard read model (spec §5.3). Stats come from task occurrences; employees never
 * receive invoice fields (the keys are absent, not hidden).
 */
export async function getDashboard(db: SupabaseClient, member: Member) {
  const tz = member.org.timezone;
  const today = localIsoDate(new Date(), tz);
  const week = weekDays(today, member.org.weekStart);
  const isManager = member.role === "manager";

  const [counts, board, notifications, feed, members, summary, invoices] = await Promise.all([
    boardCounts(db),
    listBoard(db, { limit: 30 }),
    listNotifications(db, member.userId, { limit: 4 }),
    calendarFeed(db, localMidnight(week[0], tz), localMidnight(addDays(week[6], 1), tz)),
    listMemberOptions(db, member.orgId),
    isManager ? invoiceSummary(db) : Promise.resolve(null),
    isManager ? listInvoices(db, { limit: 4, state: undefined }) : Promise.resolve(null),
  ]);

  const important = board.rows
    .filter((r: BoardRow) => r.status === "todo" || r.status === "in_progress")
    .sort((a, b) => Number(b.is_overdue) - Number(a.is_overdue) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.due_at.localeCompare(b.due_at))
    .slice(0, 4)
    .map(({ total_count: _, ...r }) => r);

  const onLeaveToday = new Set(
    feed
      .filter((i) => i.type === "leave" && i.status === "approved" && localIsoDate(new Date(i.start_at), tz) <= today && localIsoDate(new Date(new Date(i.end_at).getTime() - 1), tz) >= today)
      .map((i) => i.employee_id),
  ).size;

  const base = {
    today,
    week,
    stats: {
      todo_tasks: counts.todo,
      active_tasks: counts.todo + counts.in_progress,
      completed_tasks: counts.completed,
      overdue_tasks: counts.overdue,
      people_on_leave_today: onLeaveToday,
    },
    important_tasks: important,
    calendar_preview: { items: feed, members },
    notifications: { unread_count: notifications.unread_count, items: notifications.items },
  };

  if (!isManager || !summary || !invoices) return { role: "employee" as const, ...base };
  return {
    role: "manager" as const,
    ...base,
    stats: { ...base.stats, overdue_invoices: summary.overdue_count },
    upcoming_payments: invoices.rows,
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboard>>;
