"use client";
// Figma: پروفایل سارا محمدی (1:2024).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarCheck, CircleCheck, ListChecks, PencilLine, Plus, TriangleAlert } from "lucide-react";
import { Alert, Avatar, Badge, Button, ButtonLink, Card, CardHeader, EmptyState, StatCard } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/controls";
import { faDigits, faNumber, formatDate, formatDayMonth, formatPercent, formatStamp, formatTime, jalaliParts } from "@/lib/format";
import { PRIORITY, ROLE_LABEL, TASK_STATUS } from "@/lib/labels";
import type { BoardRow } from "@/lib/services/tasks";
import type { FeedItem, LeaveBalance, LeaveRow } from "@/lib/services/calendar";
import type { MemberOption, MemberProfile } from "@/lib/services/team";
import type { CalMe } from "@/components/calendar/calendar-view";
import { TaskFormModal } from "@/components/tasks/task-form-modal";
import { TaskDetailModal } from "@/components/tasks/task-detail-modal";
import { LeaveRequestModal } from "@/components/calendar/leave-modals";
import { EditMemberModal } from "./member-modals";
import { presence } from "./presence";

type LeaveType = { id: string; code: string; name: string; deducts_balance: boolean };

export function ProfileView({ profile, activeTasks, schedule, balance, leaves, members, leaveTypes, me }: {
  profile: MemberProfile & { avatar_url: string | null };
  activeTasks: Omit<BoardRow, "total_count">[];
  schedule: FeedItem[];
  balance: LeaveBalance | null;
  leaves: LeaveRow[];
  members: MemberOption[];
  leaveTypes: LeaveType[];
  me: CalMe & { orgId: string };
}) {
  const router = useRouter();
  const [modal, setModal] = useState<"task" | "leave" | "edit" | "history" | { occurrence: string } | null>(null);
  const isManager = me.role === "manager";
  const tz = me.timezone;
  const p = presence({ status: profile.status, on_leave_today: profile.on_leave_today, work_mode: profile.work_mode });
  const done = () => {
    setModal(null);
    router.refresh();
  };
  const remaining = balance ? Number(balance.remaining_days) : null;

  // Meetings that overlap this person's availability or each other are flagged like Figma's «همپوشانی در برنامه».
  const meetings = schedule.filter((s) => s.type === "meeting");
  const overlaps = meetings.filter((m) => schedule.some((o) => o !== m && o.type === "meeting" && o.start_at < m.end_at && m.start_at < o.end_at));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold leading-[1.8]">پروفایل کارمند</h1>
          <p className="text-xs leading-[1.8] text-muted">کارمندان / {profile.full_name}</p>
        </div>
        <div className="flex gap-2">
          {isManager && <Button icon={PencilLine} onClick={() => setModal("edit")}>ویرایش اطلاعات</Button>}
          <ButtonLink variant="secondary" href="/team">بازگشت به کارمندان</ButtonLink>
        </div>
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div className="flex items-center gap-4">
          <Avatar name={profile.full_name} seed={profile.user_id} src={profile.avatar_url} size={80} />
          <div className="flex flex-col gap-2">
            <h2 className="text-xl font-bold">{profile.full_name}</h2>
            <p className="text-xs text-muted">{profile.job_title || "—"}</p>
            <div className="flex gap-2">
              <Badge tone={profile.role === "manager" ? "purple" : "gray"}>{ROLE_LABEL[profile.role]}</Badge>
              <Badge tone={p.tone}>{p.label}</Badge>
            </div>
          </div>
        </div>
        {(isManager || profile.user_id === me.userId) && profile.status === "active" && (
          <div className="flex gap-2">
            {isManager && <Button icon={Plus} onClick={() => setModal("task")}>تخصیص تسک</Button>}
            <Button variant="secondary" onClick={() => setModal("leave")}>ثبت مرخصی</Button>
          </div>
        )}
      </Card>

      {!profile.can_view_private ? (
        <Alert tone="blue" title="اطلاعات تکمیلی این عضو فقط برای خود او و مدیر مجموعه نمایش داده می‌شود." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
              <StatCard value={faNumber(profile.stats?.active_tasks ?? 0)} label="تسک فعال" icon={ListChecks} tone="blue" />
              <StatCard value={faNumber(profile.stats?.completed_tasks ?? 0)} label="تسک تکمیل‌شده" icon={CircleCheck} tone="purple" />
              <StatCard value={remaining === null ? "—" : `${faNumber(remaining)} روز`} label="مانده مرخصی" icon={CalendarCheck} tone="green" />
            </div>

            <Card>
              <CardHeader title="تسک‌های فعال" actions={<Badge tone="blue">{faNumber(activeTasks.length)} مورد</Badge>} />
              {activeTasks.length === 0 && <EmptyState message="تسک فعالی وجود ندارد." />}
              {activeTasks.map((t) => {
                const pct = t.assignees.find((a) => a.user_id === profile.user_id)?.progress_percent ?? t.progress_percent;
                return (
                  <div key={t.occurrence_id} className="flex flex-col gap-2.5 border-t border-line p-[18px] first:border-t-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-bold">{t.title}</h3>
                      <Badge tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Badge>
                    </div>
                    {t.description && <p className="text-xs text-muted">{t.description}</p>}
                    <div className="flex items-center justify-between text-xs">
                      <span className={t.is_overdue ? "text-danger" : ""}>
                        سررسید: {formatDate(t.due_at, tz)} • پیشرفت {formatPercent(pct)}
                      </span>
                      <Badge tone={TASK_STATUS[t.is_overdue ? "overdue" : t.status].tone}>{TASK_STATUS[t.is_overdue ? "overdue" : t.status].label}</Badge>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-blue">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                    </div>
                    <Button variant="ghost" className="self-start" onClick={() => setModal({ occurrence: t.occurrence_id })}>
                      مشاهده جزئیات تسک
                    </Button>
                  </div>
                );
              })}
            </Card>

            <Card>
              <CardHeader title="زمان‌های آزاد و برنامه" />
              <div className="flex flex-col gap-3 p-[18px] pt-0">
                {schedule.length === 0 && <p className="text-xs text-muted">در دو هفته آینده زمان آزاد یا جلسه‌ای ثبت نشده است.</p>}
                {schedule.slice(0, 6).map((s) => (
                  <div key={`${s.type}-${s.id}`} className="flex items-center justify-between gap-2 border-b border-line pb-3 text-xs last:border-0">
                    <span>
                      {jalaliParts(s.start_at, tz).weekday} {formatDayMonth(s.start_at, tz)} • {formatTime(s.start_at, tz)} تا {formatTime(s.end_at, tz)}
                      {s.type === "meeting" && s.title ? ` • ${s.title}` : ""}
                    </span>
                    <Badge tone={s.type === "meeting" ? "purple" : "green"}>{s.type === "meeting" ? "جلسه" : "زمان آزاد"}</Badge>
                  </div>
                ))}
                {overlaps.length > 0 && (
                  <Alert tone="amber" icon={TriangleAlert} title={`${faNumber(overlaps.length)} هم‌پوشانی در برنامه`}>
                    {overlaps.map((o) => o.title).join("، ")} با رویداد دیگری تداخل دارد. برای جابه‌جایی زمان، تقویم را بررسی کنید.
                  </Alert>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="فعالیت‌های اخیر" />
              <div className="flex flex-col gap-3 p-[18px] pt-0">
                {(profile.recent_activity ?? []).length === 0 && <p className="text-xs text-muted">فعالیتی ثبت نشده است.</p>}
                {(profile.recent_activity ?? []).slice(0, 6).map((a, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 text-xs">
                    <span>
                      {a.kind === "availability"
                        ? `زمان آزاد برای ${formatDayMonth(a.start_date!, "UTC")} ثبت شد.`
                        : a.kind === "progress" && typeof a.metadata?.progress_percent === "number"
                          ? `پیشرفت ${a.task_title} به ${formatPercent(a.metadata.progress_percent)} رسید.`
                          : a.kind === "status_change" && a.metadata?.status === "completed"
                            ? `تسک ${a.task_title} تکمیل شد.`
                            : a.kind === "comment"
                              ? `نظری در ${a.task_title} ثبت کرد.`
                              : `${a.task_title} به‌روزرسانی شد.`}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted">{formatStamp(a.at, tz)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader title="اطلاعات تماس" />
              <dl className="flex flex-col gap-4 p-[18px] pt-0 text-xs">
                {[
                  ["ایمیل", <span key="e" className="ltr">{profile.contact?.email}</span>],
                  ["شماره موبایل", profile.contact?.phone ? faDigits(profile.contact.phone) : "—"],
                  ["تاریخ شروع همکاری", profile.contact?.joined_at ? formatDate(profile.contact.joined_at, "UTC") : "—"],
                  ["مدیر مستقیم", profile.contact?.manager_name ?? "—"],
                ].map(([k, v]) => (
                  <div key={String(k)} className="flex flex-col gap-1">
                    <dt className="text-[11px] text-muted">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </Card>

            <Card>
              <CardHeader title="اطلاعات مرخصی" />
              <div className="flex flex-col gap-3 p-[18px] pt-0 text-xs">
                <p className="text-[22px] font-bold text-success">{remaining === null ? "—" : `${faNumber(remaining)} روز`}</p>
                {balance && <p className="text-muted">از {faNumber(Number(balance.quota_days))} روز سهمیه سالانه</p>}
                <div className="flex flex-col gap-2 border-t border-line pt-3">
                  <p>استفاده‌شده: {faNumber(Number(balance?.used_days ?? 0))} روز</p>
                  <p>درخواست در انتظار: {faNumber(Number(balance?.pending_days ?? 0))} روز</p>
                </div>
                {profile.leave_this_week === false && <Badge tone="green" className="self-start">بدون مرخصی در هفته جاری</Badge>}
                {profile.leave_this_week && <Badge tone="red" className="self-start">مرخصی در هفته جاری</Badge>}
                <Button variant="secondary" className="self-start" onClick={() => setModal("history")}>
                  تاریخچه مرخصی‌ها
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )}

      {modal === "task" && <TaskFormModal mode="create" members={members} timezone={tz} defaults={{ assignee: profile.user_id }} onClose={() => setModal(null)} onSaved={done} />}
      {modal === "leave" && <LeaveRequestModal me={me} members={members} leaveTypes={leaveTypes} myBalance={profile.user_id === me.userId ? balance : null} defaultEmployee={profile.user_id} onClose={() => setModal(null)} onSaved={done} />}
      {modal === "edit" && (
        <EditMemberModal
          row={{ membership_id: profile.membership_id, user_id: profile.user_id, full_name: profile.full_name, avatar_path: profile.avatar_path, job_title: profile.job_title, role: profile.role, status: profile.status as "active", work_mode: profile.work_mode, on_leave_today: profile.on_leave_today, active_task_count: null, email: profile.contact?.email ?? null, phone: profile.contact?.phone ?? null, joined_at: profile.contact?.joined_at ?? null, manager_id: profile.contact?.manager_id ?? null }}
          me={{ userId: me.userId, role: me.role, orgId: me.orgId, timezone: tz }}
          members={members.map((m) => ({ ...m, membership_id: "", status: "active", work_mode: "office", on_leave_today: false, active_task_count: null, email: null, phone: null, joined_at: null, manager_id: null }))}
          onClose={() => setModal(null)}
          onSaved={done}
        />
      )}
      {modal === "history" && (
        <Modal open onClose={() => setModal(null)} title="تاریخچه مرخصی‌ها" subtitle={profile.full_name} width={520}>
          {leaves.length === 0 && <p className="text-xs text-muted">مرخصی ثبت نشده است.</p>}
          {leaves.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-2 border-b border-line pb-3 text-xs">
              <span>
                {formatDayMonth(l.start_at, tz)} • {faNumber(Number(l.days_count))} روز {l.leave_types?.name}
              </span>
              <Badge tone={{ pending: "amber", approved: "green", rejected: "red", cancelled: "gray" }[l.status] as "amber"}>
                {{ pending: "در انتظار", approved: "تأییدشده", rejected: "ردشده", cancelled: "لغوشده" }[l.status]}
              </Badge>
            </div>
          ))}
        </Modal>
      )}
      {modal && typeof modal === "object" && (
        <TaskDetailModal occurrenceId={modal.occurrence} me={{ userId: me.userId, role: me.role, timezone: tz }} onClose={() => setModal(null)} onChanged={() => router.refresh()} onEdit={() => router.push("/tasks")} />
      )}
    </>
  );
}
