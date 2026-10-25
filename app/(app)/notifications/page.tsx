import { requirePageMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listNotifications } from "@/lib/services/notifications";
import { NotificationsView } from "./notifications-view";

export const metadata = { title: "اعلان‌ها | GBN HRM" };

export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  const member = await requirePageMember();
  const { tab, cursor } = await searchParams;
  const unreadOnly = tab === "unread";
  const db = await createClient();
  const data = await listNotifications(db, member.userId, { unreadOnly, limit: 30, cursor: typeof cursor === "string" ? cursor : undefined });
  return <NotificationsView items={data.items} unreadCount={data.unread_count} nextCursor={data.next_cursor} unreadOnly={unreadOnly} timezone={member.org.timezone} />;
}
