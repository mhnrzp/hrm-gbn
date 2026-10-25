"use client";
// Figma «اعلان‌ها» list + «جزئیات اعلان» (1:1179, dashboard 1:3254).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bell, CalendarDays, CircleCheck, ListChecks, Receipt, Users, type LucideIcon } from "lucide-react";
import { Badge, Button, cn } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/controls";
import { api } from "@/lib/client-api";
import { formatStamp } from "@/lib/format";
import { renderNotification, type NotificationKind, type NotificationRow } from "@/lib/notification-text";

const KIND_ICON: Record<NotificationKind, { icon: LucideIcon; className: string }> = {
  task: { icon: ListChecks, className: "text-brand" },
  leave: { icon: CalendarDays, className: "text-warning" },
  invoice: { icon: Receipt, className: "text-danger" },
  done: { icon: CircleCheck, className: "text-success" },
  team: { icon: Users, className: "text-purple" },
  calendar: { icon: CalendarDays, className: "text-purple" },
  system: { icon: Bell, className: "text-muted" },
};

const CTA: Partial<Record<NotificationKind, string>> = { task: "مشاهده تسک", leave: "مشاهده تقویم", invoice: "مشاهده صورت‌حساب", done: "مشاهده", calendar: "مشاهده تقویم", team: "مشاهده کارمندان" };

export function NotificationList({ items, timezone, onChanged }: { items: NotificationRow[]; timezone: string; onChanged?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState<NotificationRow | null>(null);

  async function openItem(n: NotificationRow) {
    setOpen({ ...n, is_read: true });
    if (!n.is_read) {
      await api(`/notifications/${n.id}/read`, { method: "PATCH" }).catch(() => undefined);
      onChanged?.();
      router.refresh();
    }
  }

  const detail = open ? renderNotification(open, timezone) : null;
  return (
    <>
      <ul className="flex flex-col">
        {items.map((n) => {
          const r = renderNotification(n, timezone);
          const { icon: Icon, className } = KIND_ICON[r.kind];
          return (
            <li key={n.id}>
              <button type="button" onClick={() => openItem(n)} className={cn("flex w-full items-start gap-2.5 border-b border-line p-3.5 text-right", n.is_read ? "bg-card" : "bg-surface-blue")}>
                <Icon size={18} className={cn("mt-0.5 shrink-0", className)} aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col text-[11px] leading-[1.7]">
                  <span className="font-bold">{r.title}</span>
                  <span>{r.body}</span>
                  <span className="text-muted">{formatStamp(n.created_at, timezone)}</span>
                </span>
                <span className={cn("mt-1.5 size-[5px] shrink-0 rounded-full", n.is_read ? "bg-transparent" : "bg-brand")} aria-label={n.is_read ? undefined : "خوانده‌نشده"} />
              </button>
            </li>
          );
        })}
      </ul>
      {open && detail && (
        <Modal
          open
          onClose={() => setOpen(null)}
          title="جزئیات اعلان"
          footer={
            CTA[detail.kind] && (
              <Button
                onClick={() => {
                  setOpen(null);
                  router.push(detail.href);
                }}
              >
                {CTA[detail.kind]}
              </Button>
            )
          }
        >
          <Badge tone="gray" className="self-start">خوانده‌شده</Badge>
          <h3 className="text-[15px] font-bold">{detail.title}</h3>
          <p className="text-xs">{detail.body}</p>
          <p className="text-[11px] text-muted">{formatStamp(open.created_at, timezone)} • این اعلان خوانده شد.</p>
        </Modal>
      )}
    </>
  );
}
