import { AppShell } from "@/components/shell/app-shell";
import { requirePageMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateWithWeekday } from "@/lib/format";
import { avatarUrl } from "@/lib/services/files";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const member = await requirePageMember();
  const db = await createClient();
  const [{ count }, { data: prefs }, avatar] = await Promise.all([
    db.from("notifications").select("id", { count: "exact", head: true }).eq("recipient_user_id", member.userId).eq("is_read", false),
    db.from("member_preferences").select("compact_tables").eq("organization_id", member.orgId).eq("user_id", member.userId).maybeSingle(),
    avatarUrl(db, member.avatarPath),
  ]);

  return (
    <div data-density={prefs?.compact_tables === false ? "comfortable" : "compact"}>
      <AppShell
        user={{ id: member.userId, fullName: member.fullName, avatarUrl: avatar, role: member.role }}
        unreadCount={count ?? 0}
        todayLabel={formatDateWithWeekday(new Date(), member.org.timezone)}
      >
        {children}
      </AppShell>
    </div>
  );
}
