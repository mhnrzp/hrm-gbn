import { requirePageMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSettings, listAuditLogs } from "@/lib/services/settings";
import { avatarUrl } from "@/lib/services/files";
import { SettingsView } from "@/components/settings/settings-view";

export const metadata = { title: "تنظیمات | GBN HRM" };

export default async function SettingsPage() {
  const member = await requirePageMember();
  const db = await createClient();
  const settings = await getSettings(db, member);
  const [audit, avatar] = await Promise.all([
    member.role === "manager" ? listAuditLogs(db, { limit: 5 }) : Promise.resolve(null),
    avatarUrl(db, settings.profile.avatar_path),
  ]);
  return (
    <SettingsView
      settings={settings}
      audit={audit?.items ?? []}
      avatarUrl={avatar}
      me={{ userId: member.userId, orgId: member.orgId, role: member.role, timezone: member.org.timezone, jobTitle: member.jobTitle }}
    />
  );
}
