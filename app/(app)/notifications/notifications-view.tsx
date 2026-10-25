"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, PageTitle } from "@/components/ui/primitives";
import { Segmented } from "@/components/ui/controls";
import { NotificationList } from "@/components/notifications/notification-list";
import { api } from "@/lib/client-api";
import { faNumber } from "@/lib/format";
import type { NotificationRow } from "@/lib/notification-text";

export function NotificationsView({ items, unreadCount, nextCursor, unreadOnly, timezone }: { items: NotificationRow[]; unreadCount: number; nextCursor: string | null; unreadOnly: boolean; timezone: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function readAll() {
    setPending(true);
    await api("/notifications/read-all", { method: "POST" }).catch(() => undefined);
    setPending(false);
    router.refresh();
  }

  return (
    <>
      <PageTitle title="اعلان‌ها" subtitle="رویدادهای مربوط به تسک‌ها، مرخصی‌ها و پرداخت‌ها" />
      <Card className="max-w-[720px]">
        <CardHeader title="اعلان‌ها" actions={<Badge tone={unreadCount ? "blue" : "gray"}>{unreadCount ? `${faNumber(unreadCount)} خوانده‌نشده` : `${faNumber(0)} جدید`}</Badge>} />
        <div className="flex items-center justify-between gap-3 px-[18px] pb-3">
          <Segmented value={unreadOnly ? "unread" : "all"} onChange={(v) => router.replace(v === "unread" ? "?tab=unread" : "?")} options={[{ value: "all", label: "همه" }, { value: "unread", label: "خوانده‌نشده" }]} />
          <Button variant="ghost" disabled={pending || unreadCount === 0} onClick={readAll}>
            خواندن همه
          </Button>
        </div>
        {items.length === 0 ? (
          <EmptyState message={unreadOnly ? "همه اعلان‌ها خوانده شده‌اند." : "هنوز اعلانی ندارید."} />
        ) : (
          <NotificationList items={items} timezone={timezone} />
        )}
        {nextCursor && (
          <div className="p-3">
            <Link href={`?${unreadOnly ? "tab=unread&" : ""}cursor=${encodeURIComponent(nextCursor)}`} className="text-xs font-bold text-brand">
              اعلان‌های قدیمی‌تر
            </Link>
          </div>
        )}
      </Card>
    </>
  );
}
