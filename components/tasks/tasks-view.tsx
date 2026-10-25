"use client";
// Figma: مدیریت تسک‌ها (1:2952), mobile (1:931).
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, Filter, MoreHorizontal, Plus, Repeat2, Search, Users } from "lucide-react";
import { Alert, Avatar, Badge, Button, Card, EmptyState, PageTitle, Table, Td, Th, cn } from "@/components/ui/primitives";
import { FilterMenu, Menu, Segmented } from "@/components/ui/controls";
import { DUE_FILTER, PRIORITY, TASK_STATUS } from "@/lib/labels";
import { faNumber, formatDate } from "@/lib/format";
import { api, ApiError } from "@/lib/client-api";
import type { BoardRow } from "@/lib/services/tasks";
import type { BoardQuery } from "@/lib/validation/tasks";
import type { MemberOption } from "@/lib/services/team";
import { TaskFormModal } from "./task-form-modal";
import { TaskDetailModal } from "./task-detail-modal";

export type Me = { userId: string; role: "manager" | "employee"; timezone: string };
type Row = Omit<BoardRow, "total_count">;
type Counts = { all: number; todo: number; in_progress: number; completed: number; overdue: number };

export function TasksView({ rows, total, counts, query, view, members, me }: { rows: Row[]; total: number; counts: Counts; query: BoardQuery; view: "list" | "kanban"; members: MemberOption[]; me: Me }) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState(query.q ?? "");
  const [form, setForm] = useState<{ mode: "create" } | { mode: "edit"; taskId: string; occurrenceId: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const isManager = me.role === "manager";

  function setParams(patch: Record<string, string | undefined>, resetPage = true) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (resetPage) next.delete("page");
    startTransition(() => router.replace(`?${next.toString()}`, { scroll: false }));
  }

  // Debounced search box → ?q=
  useEffect(() => {
    if ((query.q ?? "") === search) return;
    const t = setTimeout(() => setParams({ q: search.trim() || undefined }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function archive(row: Row) {
    if (!window.confirm(`تسک «${row.title}» بایگانی شود؟ سوابق قبلی حفظ می‌شود.`)) return;
    try {
      await api(`/tasks/${row.task_id}/archive`, { method: "POST" });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.messageFa : "خطا");
    }
  }

  async function moveCard(row: Row, status: Row["status"]) {
    if (row.status === status) return;
    try {
      await api(`/task-occurrences/${row.occurrence_id}`, { method: "PATCH", body: { status } });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.messageFa : "خطا");
    }
  }

  const hasFilters = !!(query.status || query.assignee || query.priority || query.due || query.q);
  const from = total === 0 ? 0 : (query.page - 1) * query.limit + 1;
  const to = Math.min(query.page * query.limit, total);
  const pages = Math.max(1, Math.ceil(total / query.limit));

  const chip = (key: BoardQuery["status"] | undefined, label: string, count: number, tone: "blue" | "gray" | "green" | "red") => (
    <button key={label} type="button" onClick={() => setParams({ status: key })} aria-pressed={query.status === key} className={cn("rounded-badge", query.status === key && "ring-1 ring-current")}>
      <Badge tone={tone}>
        {label} {faNumber(count)}
      </Badge>
    </button>
  );

  const filters = (
    <>
      <FilterMenu label="همه وضعیت‌ها" allLabel="همه وضعیت‌ها" icon={Filter} value={query.status} onChange={(v) => setParams({ status: v })}
        options={[{ value: "todo", label: "انجام‌نشده" }, { value: "in_progress", label: "در حال انجام" }, { value: "completed", label: "تکمیل‌شده" }, { value: "overdue", label: "عقب‌افتاده" }]} />
      <FilterMenu label="همه مسئول‌ها" allLabel="همه مسئول‌ها" icon={Users} value={query.assignee} onChange={(v) => setParams({ assignee: v })}
        options={members.map((m) => ({ value: m.user_id, label: m.full_name }))} />
      <FilterMenu label="همه اولویت‌ها" allLabel="همه اولویت‌ها" icon={ChevronDown} value={query.priority} onChange={(v) => setParams({ priority: v })}
        options={(["urgent", "important", "normal"] as const).map((p) => ({ value: p, label: PRIORITY[p].label }))} />
      <FilterMenu label="همه موعدها" allLabel="همه موعدها" icon={Calendar} value={query.due} onChange={(v) => setParams({ due: v })}
        options={(["today", "week", "month", "overdue"] as const).map((d) => ({ value: d, label: DUE_FILTER[d] }))} />
      {hasFilters && (
        <Button variant="ghost" onClick={() => { setSearch(""); setParams({ status: undefined, assignee: undefined, priority: undefined, due: undefined, q: undefined }); }}>
          پاک کردن فیلترها
        </Button>
      )}
    </>
  );

  return (
    <>
      <PageTitle
        title="مدیریت تسک‌ها"
        subtitle={<><span className="hidden lg:inline">پیگیری کارها، اولویت‌ها و پیشرفت تیم</span><span className="lg:hidden">{faNumber(counts.all)} تسک در مجموعه</span></>}
        actions={isManager && <Button icon={Plus} onClick={() => setForm({ mode: "create" })}>تسک جدید</Button>}
      />

      <div className="hidden flex-wrap gap-3 lg:flex">
        {chip(undefined, "همه تسک‌ها", counts.all, "blue")}
        {chip("todo", "انجام‌نشده", counts.todo, "gray")}
        {chip("in_progress", "در حال انجام", counts.in_progress, "blue")}
        {chip("completed", "تکمیل‌شده", counts.completed, "green")}
      </div>

      {error && <Alert title={error} />}

      <Card>
        <div className="flex flex-col gap-3.5 p-[18px]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <label className="flex h-[38px] w-full items-center gap-2 rounded-ctl border border-line bg-card px-3 focus-within:border-brand lg:w-[310px]">
              <Search size={16} className="text-muted" aria-hidden />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جستجو..." aria-label="جستجوی تسک" className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted" />
            </label>
            <div className="flex items-center justify-between gap-3">
              <Segmented value={view} onChange={(v) => setParams({ view: v === "list" ? undefined : v })} options={[{ value: "list", label: "فهرست" }, { value: "kanban", label: "کانبان" }]} />
              <Button variant="secondary" icon={Filter} className="lg:hidden" onClick={() => setShowMobileFilters((s) => !s)} aria-expanded={showMobileFilters}>
                فیلترها
              </Button>
            </div>
          </div>
          <div className="hidden flex-wrap items-start gap-2.5 lg:flex">{filters}</div>
          {showMobileFilters && <div className="flex flex-wrap gap-2 lg:hidden">{filters}</div>}
          <div className="flex flex-wrap gap-2 lg:hidden">
            {chip("completed", "تکمیل‌شده", counts.completed, "green")}
            {chip("in_progress", "در حال انجام", counts.in_progress, "blue")}
            {chip("todo", "انجام‌نشده", counts.todo, "gray")}
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            message={hasFilters ? "تسکی با این فیلترها پیدا نشد." : isManager ? "هنوز تسکی ثبت نشده است. اولین کار تیم را ایجاد کنید." : "فعلاً تسکی به شما اختصاص داده نشده است."}
            action={isManager && !hasFilters && <Button icon={Plus} onClick={() => setForm({ mode: "create" })}>تسک جدید</Button>}
          />
        ) : view === "kanban" ? (
          <Kanban rows={rows} me={me} onOpen={setDetailId} onMove={moveCard} />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden lg:block">
              <Table>
                <thead>
                  <tr>
                    <Th className="w-[300px]">عنوان تسک</Th>
                    <Th className="w-[180px]">مسئول</Th>
                    <Th className="w-[110px]">اولویت</Th>
                    <Th className="w-[140px]">وضعیت</Th>
                    <Th className="w-[180px]">تاریخ سررسید</Th>
                    <Th className="w-[100px]">عملیات</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.occurrence_id} className="hover:bg-app/60">
                      <Td>
                        <button type="button" className="text-right hover:text-brand" onClick={() => setDetailId(row.occurrence_id)}>
                          {row.title}
                          {row.recurrence_type !== "none" && <span aria-label="تکرارشونده"> ↻</span>}
                        </button>
                      </Td>
                      <Td>
                        <AssigneeCell row={row} />
                      </Td>
                      <Td>
                        <Badge tone={PRIORITY[row.priority].tone}>{PRIORITY[row.priority].label}</Badge>
                      </Td>
                      <Td>
                        <Badge tone={TASK_STATUS[row.status].tone}>{TASK_STATUS[row.status].label}</Badge>
                      </Td>
                      <Td className={cn(row.is_overdue && "text-danger")}>{formatDate(row.due_at, me.timezone)}</Td>
                      <Td>
                        <RowActions row={row} isManager={isManager} onOpen={() => setDetailId(row.occurrence_id)} onEdit={() => setForm({ mode: "edit", taskId: row.task_id, occurrenceId: row.occurrence_id })} onArchive={() => archive(row)} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>

            {/* Mobile cards */}
            <div className="flex flex-col gap-3 px-[18px] pb-2 lg:hidden">
              {rows.map((row) => (
                <button key={row.occurrence_id} type="button" onClick={() => setDetailId(row.occurrence_id)} className="flex flex-col gap-2.5 rounded-card border border-line bg-card p-4 text-right">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] font-bold">{row.title}</span>
                    <Badge tone={PRIORITY[row.priority].tone}>{PRIORITY[row.priority].label}</Badge>
                  </div>
                  <span className="text-[11px] text-muted">
                    مسئول: {assigneeText(row)}
                    {row.recurrence_type !== "none" && " • تکرارشونده"}
                  </span>
                  <div className="flex items-center justify-between">
                    <span className={cn("text-[11px]", row.is_overdue ? "text-danger" : "text-muted")}>{formatDate(row.due_at, me.timezone)}</span>
                    <Badge tone={TASK_STATUS[row.status].tone}>{TASK_STATUS[row.status].label}</Badge>
                  </div>
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between p-4">
              <p className="text-[11px] text-muted">
                نمایش {faNumber(from)} تا {faNumber(to)} از {faNumber(total)} مورد
                <span className="lg:hidden"> • صفحه {faNumber(query.page)} از {faNumber(pages)}</span>
              </p>
              <nav className="flex items-center gap-1.5" aria-label="صفحه‌بندی">
                <button type="button" aria-label="صفحه قبل" disabled={query.page <= 1} onClick={() => setParams({ page: String(query.page - 1) }, false)} className="text-muted disabled:opacity-30">
                  <ChevronRight size={16} />
                </button>
                {Array.from({ length: pages }, (_, i) => i + 1)
                  .filter((p) => Math.abs(p - query.page) <= 2 || p === 1 || p === pages)
                  .map((p) => (
                    <button key={p} type="button" onClick={() => setParams({ page: String(p) }, false)} aria-current={p === query.page ? "page" : undefined}>
                      <Badge tone={p === query.page ? "blue" : "gray"}>{faNumber(p)}</Badge>
                    </button>
                  ))}
                <button type="button" aria-label="صفحه بعد" disabled={query.page >= pages} onClick={() => setParams({ page: String(query.page + 1) }, false)} className="text-muted disabled:opacity-30">
                  <ChevronLeft size={16} />
                </button>
              </nav>
            </div>
          </>
        )}
      </Card>

      <p className="flex items-center gap-2 text-[11px] text-muted">
        <Repeat2 size={15} className="text-brand" aria-hidden />
        تسک‌های دارای این نماد به‌صورت دوره‌ای تکرار می‌شوند.
      </p>

      {form && (
        <TaskFormModal
          mode={form.mode}
          taskId={form.mode === "edit" ? form.taskId : undefined}
          occurrenceId={form.mode === "edit" ? form.occurrenceId : undefined}
          members={members}
          timezone={me.timezone}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            router.refresh();
          }}
        />
      )}
      {detailId && (
        <TaskDetailModal
          occurrenceId={detailId}
          me={me}
          onClose={() => setDetailId(null)}
          onChanged={() => router.refresh()}
          onEdit={(taskId, occurrenceId) => {
            setDetailId(null);
            setForm({ mode: "edit", taskId, occurrenceId });
          }}
        />
      )}
    </>
  );
}

function assigneeText(row: Row) {
  if (row.assignment_mode === "team_pool" && row.assignees.length === 0) return "صف تیم";
  return row.assignees.map((a) => a.full_name).join("، ");
}

function AssigneeCell({ row }: { row: Row }) {
  if (row.assignees.length === 0) return <Badge tone="purple">صف تیم</Badge>;
  const first = row.assignees[0];
  return (
    <span className="flex items-center gap-2">
      <Avatar name={first.full_name} seed={first.user_id} />
      <span>{first.full_name}</span>
      {row.assignees.length > 1 && <span className="text-muted">+{faNumber(row.assignees.length - 1)}</span>}
    </span>
  );
}

function RowActions({ row, isManager, onOpen, onEdit, onArchive }: { row: Row; isManager: boolean; onOpen: () => void; onEdit: () => void; onArchive: () => void }) {
  return (
    <span className="flex items-center gap-1">
      {isManager ? (
        <button type="button" onClick={onEdit} className="hover:text-brand">
          ویرایش
        </button>
      ) : (
        <button type="button" onClick={onOpen} className="hover:text-brand">
          جزئیات
        </button>
      )}
      <Menu
        align="end"
        trigger={({ toggle }) => (
          <button type="button" onClick={toggle} aria-label={`عملیات ${row.title}`} className="px-1 text-muted hover:text-ink">
            <MoreHorizontal size={16} />
          </button>
        )}
        items={[
          { key: "view", label: "مشاهده جزئیات", onSelect: onOpen },
          ...(isManager ? [{ key: "edit", label: "ویرایش", onSelect: onEdit }, { key: "archive", label: "بایگانی", danger: true, onSelect: onArchive }] : []),
        ]}
      />
    </span>
  );
}

const KANBAN_COLUMNS: { status: Row["status"]; label: string }[] = [
  { status: "todo", label: "انجام‌نشده" },
  { status: "in_progress", label: "در حال انجام" },
  { status: "completed", label: "تکمیل‌شده" },
];

function Kanban({ rows, me, onOpen, onMove }: { rows: Row[]; me: Me; onOpen: (id: string) => void; onMove: (row: Row, status: Row["status"]) => void }) {
  const [over, setOver] = useState<string | null>(null);
  const canMove = (row: Row) => me.role === "manager" || row.assignees.some((a) => a.user_id === me.userId);
  return (
    <div className="grid gap-3 p-[18px] pt-0 md:grid-cols-3">
      {KANBAN_COLUMNS.map((col) => {
        const items = rows.filter((r) => r.status === col.status);
        return (
          <section
            key={col.status}
            aria-label={col.label}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(col.status);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const row = rows.find((r) => r.occurrence_id === e.dataTransfer.getData("text/plain"));
              if (row) onMove(row, col.status);
            }}
            className={cn("flex min-h-40 flex-col gap-2 rounded-card bg-app p-3", over === col.status && "ring-2 ring-brand")}
          >
            <h3 className="flex items-center justify-between text-xs font-bold">
              {col.label}
              <Badge tone={TASK_STATUS[col.status].tone}>{faNumber(items.length)}</Badge>
            </h3>
            {items.map((row) => (
              <article
                key={row.occurrence_id}
                draggable={canMove(row)}
                onDragStart={(e) => e.dataTransfer.setData("text/plain", row.occurrence_id)}
                onClick={() => onOpen(row.occurrence_id)}
                className={cn("flex cursor-pointer flex-col gap-2 rounded-ctl border border-line bg-card p-3", canMove(row) && "active:cursor-grabbing")}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-bold">
                    {row.title}
                    {row.recurrence_type !== "none" && " ↻"}
                  </span>
                  <Badge tone={PRIORITY[row.priority].tone}>{PRIORITY[row.priority].label}</Badge>
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted">
                  <span>{assigneeText(row)}</span>
                  <span className={cn(row.is_overdue && "text-danger")}>{formatDate(row.due_at, me.timezone)}</span>
                </div>
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}
