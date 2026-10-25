import { requirePageMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { teamDirectory } from "@/lib/services/team";
import { avatarUrls } from "@/lib/services/files";
import { TeamView } from "@/components/team/team-view";

export const metadata = { title: "مدیریت کارمندان | GBN HRM" };

export default async function TeamPage() {
  const member = await requirePageMember();
  const db = await createClient();
  const rows = await teamDirectory(db, member.role === "manager");
  const urls = await avatarUrls(db, rows.map((r) => r.avatar_path));
  return (
    <TeamView
      rows={rows.map((r) => ({ ...r, avatar_url: r.avatar_path ? urls.get(r.avatar_path) ?? null : null }))}
      me={{ userId: member.userId, role: member.role, orgId: member.orgId, timezone: member.org.timezone }}
    />
  );
}
