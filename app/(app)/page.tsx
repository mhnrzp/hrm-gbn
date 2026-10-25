import { requirePageMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDashboard } from "@/lib/services/dashboard";
import { listMemberOptions } from "@/lib/services/team";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export default async function DashboardPage() {
  const member = await requirePageMember();
  const db = await createClient();
  const [data, members] = await Promise.all([getDashboard(db, member), listMemberOptions(db, member.orgId)]);
  return <DashboardView data={data} members={members} me={{ userId: member.userId, role: member.role, timezone: member.org.timezone, weekendDays: member.org.weekendDays }} />;
}
