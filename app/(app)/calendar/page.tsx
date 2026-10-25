import { requirePageMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays, jalaliMonth, localMidnight, weekDays } from "@/lib/calendar-dates";
import { localIsoDate } from "@/lib/format";
import { calendarFeed, leaveBalance, leaveTypes, listLeaveRequests, scheduleConflicts } from "@/lib/services/calendar";
import { listMemberOptions } from "@/lib/services/team";
import { CalendarView, type CalendarViewMode } from "@/components/calendar/calendar-view";

export const metadata = { title: "تقویم و زمان‌بندی | GBN HRM" };

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const member = await requirePageMember();
  const sp = await searchParams;
  const tz = member.org.timezone;
  const today = localIsoDate(new Date(), tz);
  const view: CalendarViewMode = sp.view === "month" || sp.view === "day" ? sp.view : "week";
  const anchor = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const employee = typeof sp.employee === "string" && /^[0-9a-f-]{36}$/i.test(sp.employee) ? sp.employee : undefined;

  const days = view === "month" ? jalaliMonth(anchor, member.org.weekStart).days : view === "day" ? [anchor] : weekDays(anchor, member.org.weekStart);
  // The mobile layout always shows the surrounding week strip, so load at least that week.
  const loadDays = view === "day" ? weekDays(anchor, member.org.weekStart) : days;
  const from = localMidnight(loadDays[0], tz);
  const to = localMidnight(addDays(loadDays[loadDays.length - 1], 1), tz);

  const db = await createClient();
  const isManager = member.role === "manager";
  const [items, members, leaves, types, balance, conflicts] = await Promise.all([
    calendarFeed(db, from, to, employee ? [employee] : undefined),
    listMemberOptions(db, member.orgId),
    listLeaveRequests(db, isManager ? { status: "pending", limit: 20 } : { employee_id: member.userId, limit: 5 }),
    leaveTypes(db),
    leaveBalance(db, member.userId).catch(() => null),
    isManager ? scheduleConflicts(db, from, to) : Promise.resolve([]),
  ]);

  return (
    <CalendarView
      view={view}
      anchor={anchor}
      today={today}
      days={days}
      weekDaysOfAnchor={weekDays(anchor, member.org.weekStart)}
      items={items}
      members={members}
      employeeFilter={employee}
      leaves={leaves}
      leaveTypes={types}
      myBalance={balance}
      conflicts={conflicts}
      me={{ userId: member.userId, role: member.role, timezone: tz, weekendDays: member.org.weekendDays }}
    />
  );
}
