"use client";
// Figma: داشبورد (1:3124), mobile (1:1045).
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CalendarCheck, CircleAlert, CircleCheck, ListChecks, Plus, Receipt } from "lucide-react";
import { Avatar, Badge, Button, ButtonLink, Card, CardHeader, EmptyState, PageTitle, StatCard, Table, Td, Th, cn } from "@/components/ui/primitives";
import { api, ApiError } from "@/lib/client-api";
import { faNumber, formatDate, formatDateWithWeekday, formatDayMonth, formatToman } from "@/lib/format";
import { INVOICE_STATE, PRIORITY, TASK_STATUS } from "@/lib/labels";
import type { DashboardData } from "@/lib/services/dashboard";
import type { FeedItem } from "@/lib/services/calendar";
import type { MemberOption } from "@/lib/services/team";
import { WeekGrid, type CalMe } from "@/components/calendar/calendar-view";
import { NotificationList } from "@/components/notifications/notification-list";
import { TaskFormModal } from "@/components/tasks/task-form-modal";
import { TaskDetailModal } from "@/components/tasks/task-detail-modal";
import { InvoiceFormModal } from "@/components/invoices/invoice-form-modal";
import { AvailabilityModal } from "@/components/calendar/availability-modal";

const PREVIEW_MEMBERS = 4;

export function DashboardView({ data, members, me }: { data: DashboardData; members: MemberOption[]; me: CalMe }) {
  const router = useRouter();
  const [modal, setModal] = useState<"task" | "invoice" | "availability" | { occurrence: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState<string | null>(null);
  const isManager = data.role === "manager";
  const tz = me.timezone;
  const names = useMemo(() => new Map(members.map((m) => [m.user_id, m.full_name])), [members]);
  const previewRows = data.calendar_preview.members.slice(0, PREVIEW_MEMBERS);

  async function complete(occurrenceId: string) {
    setCompleting(occurrenceId);
    setError(null);
    try {
      await api(`/task-occurrences/${occurrenceId}/complete`, { method: "POST" });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.messageFa : "تکمیل انجام نشد.");
    } finally {
      setCompleting(null);
    }
  }

  const openCalendarItem = (i: FeedItem) => (i.type === "task" ? setModal({ occurrence: i.id }) : router.push("/calendar"));
  const done = () => {
    setModal(null);
    router.refresh();
  };

  return (
    <>
      <PageTitle title="داشبورد" subtitle="خلاصه وضعیت تیم" actions={<Badge tone="blue">امروز، {formatDateWithWeekday(data.today, "UTC").replace("، ", " ")}</Badge>} />

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StatCard value={faNumber(data.stats.todo_tasks)} label="تسک‌های انجام‌نشده" icon={ListChecks} tone="blue" />
        <StatCard value={faNumber(data.stats.overdue_tasks)} label="تسک‌های عقب‌افتاده" icon={CircleAlert} tone="red" />
        {data.role === "manager" ? (
          <StatCard value={faNumber(data.stats.overdue_invoices)} label="صورت‌حساب‌های سررسیدشده" icon={Receipt} tone="purple" />
        ) : (
          <StatCard value={faNumber(data.stats.completed_tasks)} label="تسک‌های تکمیل‌شده" icon={CircleCheck} tone="purple" />
        )}
        <StatCard value={faNumber(data.stats.people_on_leave_today)} label="مرخصی‌های امروز" icon={CalendarCheck} tone="green" />
      </div>

      {error && <p className="text-xs text-danger" role="alert">{error}</p>}

      <div className={cn("grid gap-4", isManager && "lg:grid-cols-2")}>
        <Card>
          <CardHeader title="تسک‌های مهم" actions={isManager && <Button icon={Plus} onClick={() => setModal("task")}>تسک جدید</Button>} />
          {data.important_tasks.length === 0 ? (
            <EmptyState message={isManager ? "هنوز تسکی ثبت نشده است. اولین کار تیم را ایجاد کنید." : "تسک بازی برای شما وجود ندارد."} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th className="w-8"><span className="sr-only">تکمیل</span></Th>
                  <Th>عنوان تسک</Th>
                  <Th>مسئول</Th>
                  <Th>اولویت</Th>
                  <Th>سررسید</Th>
                  <Th>وضعیت</Th>
                </tr>
              </thead>
              <tbody>
                {data.important_tasks.map((t) => {
                  const mine = t.assignees.some((a) => a.user_id === me.userId);
                  const first = t.assignees[0];
                  return (
                    <tr key={t.occurrence_id}>
                      <Td className="w-8 px-2">
                        <input
                          type="checkbox"
                          aria-label={`تکمیل ${t.title}`}
                          disabled={!(mine || isManager) || completing === t.occurrence_id}
                          onChange={() => complete(t.occurrence_id)}
                          className="size-4 accent-brand"
                        />
                      </Td>
                      <Td>
                        <button type="button" className="text-right hover:text-brand" onClick={() => setModal({ occurrence: t.occurrence_id })}>
                          {t.title}
                        </button>
                      </Td>
                      <Td>
                        {first ? (
                          <span className="flex items-center gap-2">
                            <Avatar name={first.full_name} seed={first.user_id} />
                            <span className="hidden xl:inline">{first.full_name}</span>
                          </span>
                        ) : (
                          <Badge tone="purple">صف تیم</Badge>
                        )}
                      </Td>
                      <Td><Badge tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Badge></Td>
                      <Td className={cn(t.is_overdue && "text-danger")}>{formatDayMonth(t.due_at, tz)}</Td>
                      <Td><Badge tone={TASK_STATUS[t.status].tone}>{TASK_STATUS[t.status].label}</Badge></Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
          <div className="p-2.5">
            <ButtonLink variant="ghost" href="/tasks">مشاهده همه</ButtonLink>
          </div>
        </Card>

        {data.role === "manager" && (
          <Card>
            <CardHeader title="صورت‌حساب‌ها" actions={<Button icon={Plus} onClick={() => setModal("invoice")}>صورت‌حساب جدید</Button>} />
            {data.upcoming_payments.length === 0 ? (
              <EmptyState message="هنوز صورت‌حسابی ثبت نشده است." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>عنوان</Th>
                    <Th>مبلغ</Th>
                    <Th>سررسید</Th>
                    <Th>وضعیت پرداخت</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.upcoming_payments.map((i) => (
                    <tr key={i.id}>
                      <Td>{i.title}</Td>
                      <Td>{formatToman(i.amount_irr)}</Td>
                      <Td>{formatDayMonth(i.due_date, "UTC")}</Td>
                      <Td><Badge tone={INVOICE_STATE[i.display_state].tone}>{INVOICE_STATE[i.display_state].label}</Badge></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            <div className="p-2.5">
              <ButtonLink variant="ghost" href="/invoices">مشاهده همه</ButtonLink>
            </div>
          </Card>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[342px_minmax(0,1fr)]">
        <Card className="order-2 lg:order-1">
          <CardHeader title="اعلان‌ها" actions={<Badge tone="blue">{faNumber(data.notifications.unread_count)} جدید</Badge>} />
          {data.notifications.items.length === 0 ? <EmptyState message="هنوز اعلانی ندارید." /> : <NotificationList items={data.notifications.items} timezone={tz} />}
          <div className="p-2.5">
            <ButtonLink variant="ghost" href="/notifications">مشاهده همه اعلان‌ها</ButtonLink>
          </div>
        </Card>

        <Card className="order-1 lg:order-2">
          <CardHeader title="تقویم هفتگی تیم" actions={<Button variant="secondary" icon={Plus} onClick={() => setModal("availability")}>افزودن زمان</Button>} />
          <div className="flex items-center justify-between px-[18px] py-2.5">
            <p className="text-xs font-bold">
              {formatDayMonth(data.week[0], "UTC")} تا {formatDate(data.week[6], "UTC")}
            </p>
            <ButtonLink variant="secondary" href="/calendar">امروز</ButtonLink>
          </div>
          <WeekGrid days={data.week} today={data.today} rows={previewRows} items={data.calendar_preview.items} tz={tz} names={names} onOpen={openCalendarItem} memberWidth={142} minWidth={700} />
          <div className="flex flex-wrap gap-3 p-3.5">
            <Badge tone="blue">تسک</Badge>
            <Badge tone="purple">جلسه</Badge>
            <Badge tone="green">زمان آزاد</Badge>
            <Badge tone="red">مرخصی</Badge>
          </div>
          <p className="px-3.5 pb-3.5 text-[11px] text-muted">
            نمایش {faNumber(previewRows.length)} نفر از {faNumber(data.calendar_preview.members.length)} عضو تیم •{" "}
            <a href="/calendar" className="text-brand">مشاهده تقویم کامل</a>
          </p>
        </Card>
      </div>

      {modal === "task" && <TaskFormModal mode="create" members={members} timezone={tz} onClose={() => setModal(null)} onSaved={done} />}
      {modal === "invoice" && <InvoiceFormModal onClose={() => setModal(null)} onSaved={done} />}
      {modal === "availability" && <AvailabilityModal me={me} members={members} defaultDate={data.today} onClose={() => setModal(null)} onSaved={done} />}
      {modal && typeof modal === "object" && (
        <TaskDetailModal occurrenceId={modal.occurrence} me={{ userId: me.userId, role: me.role, timezone: tz }} onClose={() => setModal(null)} onChanged={() => router.refresh()} onEdit={() => router.push("/tasks")} />
      )}
    </>
  );
}
