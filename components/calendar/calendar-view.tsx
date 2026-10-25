"use client";
// Figma: تقویم و زمان‌بندی (1:2601), monthly (1:1849), mobile (1:664), states (1:1306).
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Plus, TriangleAlert, Users } from "lucide-react";
import { Alert, Avatar, Badge, Button, ButtonLink, Card, CardHeader, EmptyState, PageTitle, cn, type Tone } from "@/components/ui/primitives";
import { FilterMenu, Segmented } from "@/components/ui/controls";
import { addDays, shiftJalaliMonth } from "@/lib/calendar-dates";
import { faDigits, faNumber, formatDate, formatDateWithWeekday, formatDayMonth, formatTime, jalaliParts, localIsoDate } from "@/lib/format";
import type { FeedItem, LeaveBalance, LeaveRow, ScheduleConflict } from "@/lib/services/calendar";
import type { MemberOption } from "@/lib/services/team";
import { TaskDetailModal } from "@/components/tasks/task-detail-modal";
import { LeaveRequestModal, LeaveReviewModal } from "./leave-modals";
import { AvailabilityModal } from "./availability-modal";
import { EventDetailModal, EventFormModal } from "./event-modals";

export type CalendarViewMode = "day" | "week" | "month";
export type CalMe = { userId: string; role: "manager" | "employee"; timezone: string; weekendDays: number[] };
type LeaveType = { id: string; code: string; name: string; deducts_balance: boolean };

export const ITEM_TONE: Record<string, Tone> = { task: "blue", meeting: "purple", availability: "green", leave: "red", leave_pending: "amber" };
const TONE_BAR: Record<Tone, string> = {
  blue: "bg-surface-blue text-brand",
  purple: "bg-tint-purple text-purple",
  green: "bg-tint-green text-success",
  red: "bg-tint-red text-danger",
  amber: "bg-tint-amber text-warning",
  gray: "bg-app text-muted",
};

export function itemTone(item: FeedItem): Tone {
  if (item.type === "leave") return item.status === "pending" ? "amber" : "red";
  return ITEM_TONE[item.type];
}

function shortTime(iso: string, tz: string) {
  const t = formatTime(iso, tz);
  return t.endsWith(":۰۰") ? t.slice(0, -3).replace(/^۰/, "") : t;
}

export function itemLabel(item: FeedItem, tz: string, names: Map<string, string>, long = false) {
  switch (item.type) {
    case "task":
      return item.title ?? "تسک";
    case "meeting":
      return long ? item.title ?? "جلسه" : `${item.title === "جلسه" || !item.title ? "جلسه" : item.title} • ${formatTime(item.start_at, tz)}`;
    case "availability":
      return `زمان آزاد${long ? ` ${names.get(item.employee_id) ?? ""}` : ""} • ${shortTime(item.start_at, tz)} تا ${shortTime(item.end_at, tz)}`;
    case "leave":
      return item.status === "pending" ? `مرخصی${long ? ` ${names.get(item.employee_id) ?? ""}` : ""} در انتظار تأیید` : `مرخصی${long ? ` ${names.get(item.employee_id) ?? ""}` : " تأییدشده"}`;
  }
}

type Modal =
  | { kind: "leave-request"; employeeId?: string }
  | { kind: "leave-review"; id: string; mode: "approve" | "reject" }
  | { kind: "availability"; ruleId?: string; employeeId?: string; date?: string }
  | { kind: "event-form"; eventId?: string; date?: string }
  | { kind: "event"; id: string }
  | { kind: "task"; id: string }
  | null;

export function CalendarView(props: {
  view: CalendarViewMode;
  anchor: string;
  today: string;
  days: string[];
  weekDaysOfAnchor: string[];
  items: FeedItem[];
  members: MemberOption[];
  employeeFilter?: string;
  leaves: LeaveRow[];
  leaveTypes: LeaveType[];
  myBalance: LeaveBalance | null;
  conflicts: ScheduleConflict[];
  me: CalMe;
}) {
  const { view, anchor, today, days, items, members, employeeFilter, leaves, conflicts, me } = props;
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [modal, setModal] = useState<Modal>(null);
  const [selectedDay, setSelectedDay] = useState(props.weekDaysOfAnchor.includes(today) ? today : anchor);
  const isManager = me.role === "manager";
  const tz = me.timezone;
  const names = useMemo(() => new Map(members.map((m) => [m.user_id, m.full_name])), [members]);
  const rows = employeeFilter ? members.filter((m) => m.user_id === employeeFilter) : members;
  const pending = leaves.filter((l) => l.status === "pending");

  function nav(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    startTransition(() => router.replace(`?${next.toString()}`, { scroll: false }));
  }

  const step = (dir: 1 | -1) => (view === "month" ? shiftJalaliMonth(anchor, dir) : addDays(anchor, dir * (view === "week" ? 7 : 1)));
  const rangeLabel =
    view === "month"
      ? (() => {
          const p = jalaliParts(anchor, "UTC");
          return `${p.monthName} ${faDigits(p.year)}`;
        })()
      : view === "day"
        ? formatDateWithWeekday(anchor, "UTC")
        : `${formatDayMonth(days[0], "UTC")} تا ${formatDate(days[6], "UTC")}`;
  const prevLabel = view === "month" ? "ماه قبل" : view === "week" ? "هفته قبل" : "روز قبل";
  const nextLabel = view === "month" ? "ماه بعد" : view === "week" ? "هفته بعد" : "روز بعد";

  function openItem(item: FeedItem) {
    if (item.type === "task") setModal({ kind: "task", id: item.id });
    else if (item.type === "meeting" && item.meta.details) setModal({ kind: "event", id: item.id });
    else if (item.type === "leave" && item.status === "pending" && isManager && item.employee_id !== me.userId) setModal({ kind: "leave-review", id: item.id, mode: "approve" });
    else if (item.type === "availability" && (isManager || item.employee_id === me.userId)) setModal({ kind: "availability", ruleId: String(item.meta.rule_id), employeeId: item.employee_id });
  }

  const refresh = () => {
    setModal(null);
    router.refresh();
  };

  return (
    <>
      <PageTitle
        title="تقویم و زمان‌بندی"
        subtitle={view === "month" ? `نمای ماهانه • ${rangeLabel}` : "برنامه هفتگی، زمان‌های آزاد و مرخصی اعضای تیم"}
        actions={
          <>
            {isManager && (
              <Button variant={view === "month" ? "primary" : "secondary"} icon={Plus} onClick={() => setModal({ kind: "event-form", date: selectedDay })}>
                افزودن رویداد
              </Button>
            )}
            {view !== "month" && (
              <>
                <Button icon={Plus} onClick={() => setModal({ kind: "availability", date: selectedDay })}>
                  <span className="hidden sm:inline">افزودن زمان آزاد</span>
                  <span className="sm:hidden">افزودن</span>
                </Button>
                <Button variant="secondary" className="hidden lg:inline-flex" onClick={() => setModal({ kind: "leave-request" })}>
                  درخواست مرخصی
                </Button>
              </>
            )}
          </>
        }
      />

      <Card>
        <div className="flex flex-col gap-3 p-[18px] lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" icon={ChevronRight} onClick={() => nav({ date: step(-1) })} className="hidden lg:inline-flex">
              {prevLabel}
            </Button>
            <button type="button" aria-label={prevLabel} onClick={() => nav({ date: step(-1) })} className="text-muted lg:hidden">
              <ChevronRight size={18} />
            </button>
            <p className="text-[15px] font-bold">{rangeLabel}</p>
            <button type="button" aria-label={nextLabel} onClick={() => nav({ date: step(1) })} className="text-muted lg:hidden">
              <ChevronLeft size={18} />
            </button>
            <Button variant="secondary" onClick={() => nav({ date: step(1) })} className="hidden flex-row-reverse lg:inline-flex">
              <ChevronLeft size={16} aria-hidden />
              {nextLabel}
            </Button>
            <Button variant="secondary" onClick={() => { setSelectedDay(today); nav({ date: undefined }); }}>
              {view === "month" ? `امروز، ${formatDayMonth(today, "UTC")}` : "امروز"}
            </Button>
          </div>
          <Segmented value={view} onChange={(v) => nav({ view: v === "week" ? undefined : v })} options={[{ value: "day", label: "روزانه" }, { value: "week", label: "هفتگی" }, { value: "month", label: "ماهانه" }]} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-[18px] pb-[18px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="hidden text-xs text-muted lg:inline">نمایش برنامه:</span>
            <FilterMenu label="همه کارمندان" allLabel="همه کارمندان" icon={Users} value={employeeFilter} onChange={(v) => nav({ employee: v })} options={members.map((m) => ({ value: m.user_id, label: m.full_name }))} />
          </div>
          <Badge tone="blue">{employeeFilter ? `${names.get(employeeFilter)} • نمای فردی` : `${faNumber(members.length)} عضو • نمای تیم`}</Badge>
        </div>

        {view === "month" ? (
          <MonthGrid days={days} anchor={anchor} today={today} items={items} tz={tz} names={names} selected={selectedDay} onSelect={setSelectedDay} onOpen={openItem} />
        ) : (
          <>
            <div className="hidden lg:block">
              {view === "week" ? (
                <WeekGrid days={days} today={today} rows={rows} items={items} tz={tz} names={names} onOpen={openItem} />
              ) : (
                <DayAgenda day={anchor} rows={rows} items={items} tz={tz} onOpen={openItem} />
              )}
            </div>
            <div className="lg:hidden">
              <WeekStrip days={props.weekDaysOfAnchor} selected={selectedDay} onSelect={setSelectedDay} />
              <h3 className="px-[18px] pt-4 text-[13px] font-bold">{formatDateWithWeekday(selectedDay, "UTC")}</h3>
              <DayAgenda day={selectedDay} rows={rows} items={items} tz={tz} onOpen={openItem} cards />
            </div>
          </>
        )}

        <div className="flex flex-wrap justify-start gap-3 p-3.5" aria-label="راهنمای رنگ‌ها">
          <Badge tone="blue">تسک</Badge>
          <Badge tone="purple">جلسه</Badge>
          <Badge tone="green">زمان آزاد</Badge>
          <Badge tone="red">مرخصی</Badge>
        </div>
      </Card>

      {view === "month" && (
        <Card>
          <CardHeader title={formatDateWithWeekday(selectedDay, "UTC")} />
          <DayAgenda day={selectedDay} rows={members} items={items} tz={tz} onOpen={openItem} compact names={names} />
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {isManager && (
          <Card>
            <CardHeader title="تداخل‌های زمان‌بندی" actions={<Badge tone={conflicts.length ? "red" : "green"}>{conflicts.length ? `${faNumber(conflicts.length)} تداخل` : "بدون تداخل"}</Badge>} />
            <div className="flex flex-col gap-3 p-[18px] pt-0">
              {conflicts.length === 0 && <p className="text-xs text-muted">در این بازه تداخلی پیدا نشد.</p>}
              {conflicts.slice(0, 4).map((c, i) => (
                <div key={i} className="flex flex-col gap-3">
                  <Alert tone="amber" icon={TriangleAlert} title={`تداخل در برنامه ${c.full_name}`}>
                    {`${jalaliParts(c.start_at, tz).weekday} ${formatDayMonth(c.start_at, tz)}`}
                    {c.kind === "meeting_overlap"
                      ? `، ساعت ${formatTime(c.start_at, tz)} تا ${formatTime(c.end_at, tz)}؛ ${c.title} با ${c.items.map((x) => (x.kind === "approved_leave" ? "مرخصی تأییدشده" : x.title)).join("، ")} هم‌پوشانی دارد.`
                      : `؛ مرخصی ${c.leave_status === "pending" ? "در انتظار تأیید" : "تأییدشده"} با ${faNumber(c.items.length)} تسک (${c.items.map((x) => x.title).join("، ")}) تداخل دارد.`}
                  </Alert>
                  <div className="flex gap-2">
                    {c.kind === "meeting_overlap" && c.event_id ? (
                      <>
                        <Button onClick={() => setModal({ kind: "event-form", eventId: c.event_id })}>بررسی و تغییر زمان</Button>
                        <Button variant="secondary" onClick={() => setModal({ kind: "event", id: c.event_id! })}>
                          مشاهده رویداد
                        </Button>
                      </>
                    ) : (
                      c.items[0]?.occurrence_id && <Button variant="secondary" onClick={() => setModal({ kind: "task", id: c.items[0].occurrence_id! })}>مشاهده تسک</Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card>
          <CardHeader
            title={isManager ? "درخواست‌های مرخصی" : "درخواست‌های مرخصی من"}
            actions={pending.length > 0 && <Badge tone="amber">{faNumber(pending.length)} در انتظار</Badge>}
          />
          <div className="flex flex-col gap-4 p-[18px] pt-0">
            {leaves.length === 0 && (
              <EmptyState message={isManager ? "درخواست مرخصی در انتظار بررسی نیست." : "هنوز درخواست مرخصی ثبت نکرده‌اید."} />
            )}
            {leaves.map((l) => (
              <LeaveCard key={l.id} leave={l} tz={tz} isManager={isManager} me={me.userId} jobTitle={members.find((m) => m.user_id === l.employee_id)?.job_title}
                onReview={(mode) => setModal({ kind: "leave-review", id: l.id, mode })} />
            ))}
            <Button variant="secondary" className="self-start lg:hidden" onClick={() => setModal({ kind: "leave-request" })}>
              درخواست مرخصی
            </Button>
            {!isManager && (
              <ButtonLink variant="ghost" href={`/team/${me.userId}`} className="self-start">
                مشاهده مانده مرخصی
              </ButtonLink>
            )}
          </div>
        </Card>
      </div>

      {modal?.kind === "leave-request" && (
        <LeaveRequestModal me={me} members={members} leaveTypes={props.leaveTypes} myBalance={props.myBalance} defaultEmployee={modal.employeeId} onClose={() => setModal(null)} onSaved={refresh} />
      )}
      {modal?.kind === "leave-review" && <LeaveReviewModal id={modal.id} initialMode={modal.mode} tz={tz} onClose={() => setModal(null)} onSaved={refresh} />}
      {modal?.kind === "availability" && (
        <AvailabilityModal me={me} members={members} ruleId={modal.ruleId} defaultEmployee={modal.employeeId} defaultDate={modal.date ?? today} onClose={() => setModal(null)} onSaved={refresh} />
      )}
      {modal?.kind === "event-form" && <EventFormModal eventId={modal.eventId} defaultDate={modal.date ?? today} members={members} tz={tz} onClose={() => setModal(null)} onSaved={refresh} />}
      {modal?.kind === "event" && (
        <EventDetailModal id={modal.id} tz={tz} canEdit={isManager} onClose={() => setModal(null)} onEdit={() => setModal({ kind: "event-form", eventId: modal.id })} onChanged={refresh} />
      )}
      {modal?.kind === "task" && (
        <TaskDetailModal occurrenceId={modal.id} me={{ userId: me.userId, role: me.role, timezone: tz }} onClose={() => setModal(null)} onChanged={() => router.refresh()} onEdit={() => router.push("/tasks")} />
      )}
    </>
  );
}

function LeaveCard({ leave, tz, isManager, me, jobTitle, onReview }: { leave: LeaveRow; tz: string; isManager: boolean; me: string; jobTitle?: string; onReview: (mode: "approve" | "reject") => void }) {
  const endDay = new Date(new Date(leave.end_at).getTime() - 1000).toISOString();
  const statusTone: Record<string, Tone> = { pending: "amber", approved: "green", rejected: "red", cancelled: "gray" };
  const statusLabel: Record<string, string> = { pending: "در انتظار تأیید", approved: "تأییدشده", rejected: "ردشده", cancelled: "لغوشده" };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Avatar name={leave.employee?.full_name ?? ""} seed={leave.employee_id} />
        <div className="flex-1 text-xs font-bold leading-[1.7]">
          <p>{leave.employee?.full_name}</p>
          {jobTitle && <p>{jobTitle}</p>}
        </div>
        {!isManager && <Badge tone={statusTone[leave.status]}>{statusLabel[leave.status]}</Badge>}
      </div>
      <p className="text-xs">
        {formatDayMonth(leave.start_at, tz)} تا {formatDate(endDay, tz)} • {faNumber(Number(leave.days_count))} روز مرخصی {leave.leave_types?.name}
      </p>
      <p className="text-[11px] text-muted">دلیل: {leave.reason_private}</p>
      {leave.manager_comment && <p className="text-[11px] text-muted">یادداشت مدیر: {leave.manager_comment}</p>}
      {isManager && leave.status === "pending" && leave.employee_id !== me && (
        <div className="flex gap-2">
          <Button onClick={() => onReview("approve")}>بررسی درخواست</Button>
          <Button variant="secondary" onClick={() => onReview("reject")}>
            رد درخواست
          </Button>
        </div>
      )}
    </div>
  );
}

/* ── Week grid: members × 7 days with lane-packed bars ── */

export function WeekGrid({ days, today, rows, items, tz, names, onOpen, memberWidth = 200, minWidth = 960 }: { days: string[]; today: string; rows: MemberOption[]; items: FeedItem[]; tz: string; names: Map<string, string>; onOpen: (i: FeedItem) => void; memberWidth?: number; minWidth?: number }) {
  const col = (iso: string) => days.indexOf(iso);
  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth }}>
        <div className="grid bg-app text-center" style={{ gridTemplateColumns: `${memberWidth}px repeat(7, minmax(0, 1fr))` }}>
          <div className="flex h-[52px] items-center justify-center text-[11px]">اعضای تیم</div>
          {days.map((d) => {
            const p = jalaliParts(d, "UTC");
            return (
              <div key={d} className={cn("flex h-[52px] flex-col justify-center text-[10px] leading-[1.7]", d === today ? "text-brand" : "text-muted")}>
                <span>{p.weekday}</span>
                <span>{formatDayMonth(d, "UTC")}</span>
              </div>
            );
          })}
        </div>
        {rows.map((m) => {
          const bars = items
            .filter((i) => i.employee_id === m.user_id)
            .map((i) => {
              let s = col(localIsoDate(new Date(i.start_at), tz));
              let e = col(localIsoDate(new Date(new Date(i.end_at).getTime() - 1), tz));
              if (s === -1) s = localIsoDate(new Date(i.start_at), tz) < days[0] ? 0 : -1;
              if (e === -1) e = localIsoDate(new Date(i.end_at), tz) > days[6] ? 6 : -1;
              return { item: i, s, e: Math.max(s, e) };
            })
            .filter((b) => b.s !== -1 && b.e !== -1)
            .sort((a, b) => a.s - b.s || b.e - a.e);
          const laneEnds: number[] = [];
          const placed = bars.map((b) => {
            let lane = laneEnds.findIndex((end) => end < b.s);
            if (lane === -1) lane = laneEnds.push(-1) - 1;
            laneEnds[lane] = b.e;
            return { ...b, lane };
          });
          const height = Math.max(88, 12 + laneEnds.length * 38);
          return (
            <div key={m.user_id} className="grid border-b border-line" style={{ gridTemplateColumns: `${memberWidth}px repeat(7, minmax(0, 1fr))`, minHeight: height }}>
              <div className="flex items-center gap-2 p-3" style={{ gridRow: `1 / span ${Math.max(1, laneEnds.length)}` }}>
                <Avatar name={m.full_name} seed={m.user_id} />
                <span className="text-xs font-bold">{m.full_name}</span>
              </div>
              {days.map((d, i) => (
                <div key={d} className="border-r border-line" style={{ gridColumn: i + 2, gridRow: `1 / span ${Math.max(1, laneEnds.length)}` }} />
              ))}
              {placed.map(({ item, s, e, lane }) => (
                <button
                  key={`${item.type}-${item.id}-${lane}`}
                  type="button"
                  onClick={() => onOpen(item)}
                  title={itemLabel(item, tz, names, true)}
                  className={cn("z-10 mx-1 mt-2 flex h-[26px] items-center overflow-hidden rounded-xs px-[5px] text-[10px] leading-[1.7] whitespace-nowrap", TONE_BAR[itemTone(item)])}
                  style={{ gridColumn: `${s + 2} / ${e + 3}`, gridRow: lane + 1 }}
                >
                  {itemLabel(item, tz, names)}
                </button>
              ))}
            </div>
          );
        })}
        {rows.length === 0 && <EmptyState message="عضو فعالی برای نمایش وجود ندارد." />}
      </div>
    </div>
  );
}

/* ── Mobile week strip ── */

function WeekStrip({ days, selected, onSelect }: { days: string[]; selected: string; onSelect: (d: string) => void }) {
  return (
    <div className="grid grid-cols-7 gap-1.5 px-[18px]">
      {days.map((d) => {
        const p = jalaliParts(d, "UTC");
        return (
          <button key={d} type="button" onClick={() => onSelect(d)} aria-pressed={d === selected}
            className={cn("flex flex-col items-center gap-1 rounded-ctl py-2 text-[11px]", d === selected ? "bg-brand font-bold text-white" : "bg-app text-muted")}>
            <span>{p.weekday.slice(0, 1)}</span>
            <span className="text-sm font-bold">{faDigits(p.day)}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Day agenda (day view, mobile, month detail) ── */

function DayAgenda({ day, rows, items, tz, onOpen, cards, compact, names }: { day: string; rows: MemberOption[]; items: FeedItem[]; tz: string; onOpen: (i: FeedItem) => void; cards?: boolean; compact?: boolean; names?: Map<string, string> }) {
  const onDay = items.filter((i) => localIsoDate(new Date(i.start_at), tz) <= day && localIsoDate(new Date(new Date(i.end_at).getTime() - 1), tz) >= day);
  const label = (i: FeedItem) => (i.type === "leave" ? (i.meta.leave_type ? `مرخصی ${i.meta.leave_type}` : "مرخصی") : i.type === "availability" ? "زمان آزاد" : i.title ?? "جلسه");
  const time = (i: FeedItem) =>
    i.type === "leave" && i.meta.all_day ? "تمام روز" : `${formatTime(i.start_at, tz)} تا ${formatTime(i.end_at, tz)}`;
  const typeBadge = { task: "تسک", meeting: "جلسه", availability: "زمان آزاد", leave: "مرخصی" } as const;

  if (compact) {
    return (
      <div className="flex flex-col gap-3 p-[18px] pt-0">
        {onDay.length === 0 && <p className="text-xs text-muted">برنامه‌ای برای این روز ثبت نشده است.</p>}
        {onDay.map((i) => (
          <button key={`${i.type}-${i.id}-${i.employee_id}`} type="button" onClick={() => onOpen(i)} className="flex items-center justify-between gap-2 text-right text-xs">
            <span>
              {i.type === "leave" ? `${names?.get(i.employee_id)} • ${time(i)} • ${i.status === "pending" ? "در انتظار تأیید" : "تأییدشده"}` : `${label(i)} • ${names?.get(i.employee_id)} • ${time(i)}`}
            </span>
            <Badge tone={itemTone(i)}>{typeBadge[i.type]}</Badge>
          </button>
        ))}
      </div>
    );
  }

  const withItems = rows.map((m) => ({ m, list: onDay.filter((i) => i.employee_id === m.user_id) })).filter((r) => !cards || r.list.length > 0);
  return (
    <div className={cn("flex flex-col", cards ? "gap-3 p-[18px]" : "")}>
      {withItems.length === 0 && <p className="p-[18px] text-xs text-muted">برنامه‌ای برای این روز ثبت نشده است.</p>}
      {withItems.map(({ m, list }) => (
        <div key={m.user_id} className={cn(cards ? "rounded-card border border-line p-4" : "border-b border-line p-4")}>
          <div className="flex items-center gap-2 border-b border-line pb-3">
            <Avatar name={m.full_name} seed={m.user_id} />
            <span className="text-xs font-bold">{m.full_name}</span>
          </div>
          {list.length === 0 && <p className="pt-3 text-[11px] text-muted">برنامه‌ای ثبت نشده (وضعیت نامشخص)</p>}
          {list.map((i) => (
            <button key={`${i.type}-${i.id}`} type="button" onClick={() => onOpen(i)} className="flex w-full items-start justify-between gap-2 pt-3 text-right">
              <span className="flex flex-col gap-1">
                <span className="text-xs font-bold">{label(i)}</span>
                <span className="text-[11px] text-muted">{time(i)}</span>
              </span>
              <Badge tone={itemTone(i)}>{typeBadge[i.type]}</Badge>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── Month grid (1:1849) ── */

function MonthGrid({ days, anchor, today, items, tz, names, selected, onSelect, onOpen }: { days: string[]; anchor: string; today: string; items: FeedItem[]; tz: string; names: Map<string, string>; selected: string; onSelect: (d: string) => void; onOpen: (i: FeedItem) => void }) {
  const month = jalaliParts(anchor, "UTC").month;
  const weekdays = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];
  const byDay = new Map<string, FeedItem[]>();
  for (const i of items) {
    // Month chips: one per item on its start day (leave/availability once per person-day).
    const d = localIsoDate(new Date(i.start_at), tz);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(i);
  }
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[700px] grid-cols-7">
        {weekdays.map((w) => (
          <div key={w} className="bg-app py-3 text-center text-xs font-bold text-muted">
            {w}
          </div>
        ))}
        {days.map((d) => {
          const p = jalaliParts(d, "UTC");
          const outside = p.month !== month;
          const list = byDay.get(d) ?? [];
          return (
            <div
              key={d}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(d)}
              onKeyDown={(e) => e.key === "Enter" && onSelect(d)}
              className={cn("flex min-h-[112px] cursor-pointer flex-col gap-1.5 border-b border-l border-line p-2 text-right", outside && "bg-app/60", d === today && "bg-surface-blue", d === selected && "ring-2 ring-inset ring-brand")}
            >
              <span className={cn("text-xs", d === today ? "font-bold text-brand" : outside ? "text-muted" : "text-ink")}>
                {p.day === "1" || outside ? `${faDigits(p.day)}${outside || p.day === "1" ? ` ${p.monthName}` : ""}` : faDigits(p.day)}
              </span>
              {list.slice(0, 3).map((i) => (
                <button
                  key={`${i.type}-${i.id}-${i.employee_id}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(i);
                  }}
                  className={cn("self-start truncate rounded-badge px-2 py-[3px] text-[11px]", TONE_BAR[itemTone(i)])}
                  title={itemLabel(i, tz, names, true)}
                >
                  {i.type === "leave" ? `مرخصی ${names.get(i.employee_id)?.split(" ")[0] ?? ""}${i.status === "pending" ? " • در انتظار" : ""}` : i.type === "availability" ? `زمان آزاد ${names.get(i.employee_id)?.split(" ")[0] ?? ""}` : i.title}
                </button>
              ))}
              {list.length > 3 && <span className="text-[10px] text-muted">+{faNumber(list.length - 3)} مورد دیگر</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
