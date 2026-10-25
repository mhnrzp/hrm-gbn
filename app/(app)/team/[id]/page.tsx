import { notFound } from "next/navigation";
import { requirePageMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppError } from "@/lib/errors";
import { addDays, localMidnight } from "@/lib/calendar-dates";
import { localIsoDate } from "@/lib/format";
import { memberProfile, listMemberOptions } from "@/lib/services/team";
import { listBoard } from "@/lib/services/tasks";
import { calendarFeed, leaveBalance, leaveTypes, listLeaveRequests } from "@/lib/services/calendar";
import { avatarUrl } from "@/lib/services/files";
import { ProfileView } from "@/components/team/profile-view";

export const metadata = { title: "پروفایل کارمند | GBN HRM" };

export default async function MemberProfilePage({ params }: PageProps<"/team/[id]">) {
  const me = await requirePageMember();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await createClient();
  const profile = await memberProfile(db, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const tz = me.org.timezone;
  const today = localIsoDate(new Date(), tz);
  const priv = profile.can_view_private;

  const [tasks, schedule, balance, leaves, members, types, avatar] = await Promise.all([
    priv ? listBoard(db, { assignee: id, limit: 5 }) : Promise.resolve({ rows: [], total: 0 }),
    calendarFeed(db, localMidnight(today, tz), localMidnight(addDays(today, 14), tz), [id]),
    priv ? leaveBalance(db, id).catch(() => null) : Promise.resolve(null),
    priv ? listLeaveRequests(db, { employee_id: id, limit: 20 }) : Promise.resolve([]),
    listMemberOptions(db, me.orgId),
    leaveTypes(db),
    avatarUrl(db, profile.avatar_path),
  ]);

  return (
    <ProfileView
      profile={{ ...profile, avatar_url: avatar }}
      activeTasks={tasks.rows.filter((t) => t.status !== "completed").map(({ total_count: _, ...t }) => t)}
      schedule={schedule.filter((i) => i.type === "availability" || i.type === "meeting")}
      balance={balance}
      leaves={leaves}
      members={members}
      leaveTypes={types}
      me={{ userId: me.userId, role: me.role, timezone: tz, weekendDays: me.org.weekendDays, orgId: me.orgId }}
    />
  );
}
