"use client";
// Figma: «تسک جدید» / «ویرایش تسک» (حالت‌های تسک 1:1665).
import { useEffect, useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import { Alert, Button, LoadingState } from "@/components/ui/primitives";
import { DateField, Modal, SelectField, TextAreaField, TextField, TimeField, Toggle } from "@/components/ui/controls";
import { api, ApiError, fieldError } from "@/lib/client-api";
import { PRIORITY, TASK_STATUS } from "@/lib/labels";
import { formatDate, jalaliParts } from "@/lib/format";
import type { MemberOption } from "@/lib/services/team";

const POOL = "__pool";

type Warning = { full_name: string; start_at: string; end_at: string };

type FormState = {
  title: string;
  assignee: string;
  priority: string;
  due_date: string;
  due_time: string;
  start_date: string;
  recurring: boolean;
  recurrence_type: "daily" | "weekly" | "monthly";
  recurrence_end_date: string;
  description: string;
  status: string;
};

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const EMPTY: FormState = {
  title: "",
  assignee: "",
  priority: "normal",
  due_date: "",
  due_time: "17:00",
  start_date: "",
  recurring: false,
  recurrence_type: "monthly",
  recurrence_end_date: "",
  description: "",
  status: "todo",
};

export function TaskFormModal({ mode, taskId, occurrenceId, members, timezone, onClose, onSaved, defaults }: { mode: "create" | "edit"; taskId?: string; occurrenceId?: string; members: MemberOption[]; timezone: string; onClose: () => void; onSaved: () => void; defaults?: Partial<FormState> }) {
  const [state, setState] = useState<FormState>({ ...EMPTY, due_date: today(), ...defaults });
  const [initial, setInitial] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(mode === "edit");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [warnings, setWarnings] = useState<Warning[] | null>(null);

  useEffect(() => {
    if (mode !== "edit" || !taskId) return;
    Promise.all([
      api<{ title: string; description: string; priority: string; assignment_mode: string; due_date: string; due_time: string; start_date: string | null; recurrence_type: string; recurrence_end_date: string | null; task_assignees: { user_id: string }[] }>(`/tasks/${taskId}`),
      occurrenceId ? api<{ status: string }>(`/task-occurrences/${occurrenceId}`) : Promise.resolve({ status: "todo" }),
    ])
      .then(([t, o]) => {
        const loaded: FormState = {
          title: t.title,
          assignee: t.assignment_mode === "team_pool" ? POOL : t.task_assignees[0]?.user_id ?? "",
          priority: t.priority,
          due_date: t.due_date,
          due_time: t.due_time.slice(0, 5),
          start_date: t.start_date ?? "",
          recurring: t.recurrence_type !== "none",
          recurrence_type: (["daily", "weekly", "monthly"].includes(t.recurrence_type) ? t.recurrence_type : "monthly") as FormState["recurrence_type"],
          recurrence_end_date: t.recurrence_end_date ?? "",
          description: t.description,
          status: o.status,
        };
        setState(loaded);
        setInitial(loaded);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [mode, taskId, occurrenceId]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setState((s) => ({ ...s, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const schedule = {
      due_date: state.due_date,
      due_time: state.due_time,
      start_date: state.start_date || null,
      recurrence_type: state.recurring ? state.recurrence_type : "none",
      recurrence_end_date: state.recurring && state.recurrence_end_date ? state.recurrence_end_date : null,
    };
    try {
      if (mode === "create") {
        const pool = state.assignee === POOL;
        const res = await api<{ warnings: Warning[] }>("/tasks", {
          body: {
            title: state.title,
            description: state.description,
            priority: state.priority,
            assignment_mode: pool ? "team_pool" : "named",
            assignee_ids: pool || !state.assignee ? [] : [state.assignee],
            ...schedule,
          },
        });
        if (res.warnings?.length) {
          setWarnings(res.warnings);
          return;
        }
      } else if (taskId && initial) {
        const patch: Record<string, unknown> = {};
        if (state.title !== initial.title) patch.title = state.title;
        if (state.description !== initial.description) patch.description = state.description;
        if (state.priority !== initial.priority) patch.priority = state.priority;
        if (state.assignee !== initial.assignee && state.assignee !== POOL) patch.assignee_ids = [state.assignee];
        const scheduleChanged =
          state.due_date !== initial.due_date || state.due_time !== initial.due_time || state.start_date !== initial.start_date ||
          state.recurring !== initial.recurring || state.recurrence_type !== initial.recurrence_type || state.recurrence_end_date !== initial.recurrence_end_date;
        if (scheduleChanged) Object.assign(patch, schedule);
        if (Object.keys(patch).length) await api(`/tasks/${taskId}`, { method: "PATCH", body: patch });
        if (occurrenceId && state.status !== initial.status) await api(`/task-occurrences/${occurrenceId}`, { method: "PATCH", body: { status: state.status } });
      }
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  const memberOptions = [
    ...members.map((m) => ({ value: m.user_id, label: m.full_name })),
    ...(mode === "create" ? [{ value: POOL, label: "صف تیم (اولین داوطلب برمی‌دارد)" }] : []),
  ];
  const errMsg = error instanceof ApiError ? error.messageFa : error ? "ذخیره انجام نشد. دوباره تلاش کنید." : null;

  if (warnings) {
    return (
      <Modal open onClose={onSaved} title="تسک ذخیره شد" footer={<Button onClick={onSaved}>متوجه شدم</Button>}>
        <Alert tone="amber" title="تداخل با مرخصی تأییدشده">
          {warnings.map((w, i) => (
            <p key={i}>
              {w.full_name} از {formatDate(w.start_at, timezone)} تا {formatDate(w.end_at, timezone)} مرخصی تأییدشده دارد. در صورت نیاز تسک را جابه‌جا یا به فرد دیگری بسپارید.
            </p>
          ))}
        </Alert>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === "create" ? "تسک جدید" : "ویرایش تسک"}
      subtitle={mode === "create" ? "مشخصات کار را برای تخصیص به تیم وارد کنید." : state.title}
      footer={
        <>
          <Button type="submit" form="task-form" icon={Check} disabled={pending || loading}>
            {mode === "create" ? "ذخیره تسک" : "ذخیره تغییرات"}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            انصراف
          </Button>
        </>
      }
    >
      {loading ? (
        <LoadingState />
      ) : (
        <form id="task-form" onSubmit={submit} className="flex flex-col gap-3">
          {errMsg && <Alert title={errMsg} />}
          <TextField label="عنوان تسک" required placeholder="عنوان تسک را وارد کنید" value={state.title} onChange={(e) => set("title", e.target.value)} maxLength={200} error={fieldError(error, "title")} />
          <SelectField label="مسئول" required placeholder="انتخاب مسئول" options={memberOptions} value={state.assignee} onChange={(e) => set("assignee", e.target.value)} error={fieldError(error, "assignee_ids")} />
          <SelectField label="اولویت" options={Object.entries(PRIORITY).map(([value, p]) => ({ value, label: p.label }))} value={state.priority} onChange={(e) => set("priority", e.target.value)} />
          <div className="grid grid-cols-2 gap-2.5">
            <DateField label="تاریخ سررسید" required value={state.due_date} onChange={(v) => set("due_date", v)} error={fieldError(error, "due_date")} />
            <TimeField label="ساعت سررسید" value={state.due_time} onChange={(e) => set("due_time", e.target.value)} />
          </div>
          <DateField label="تاریخ شروع (اختیاری)" placeholder="بدون تاریخ شروع" value={state.start_date} onChange={(v) => set("start_date", v)} error={fieldError(error, "start_date")} />
          <Toggle label="تکرار دوره‌ای" description={state.recurring ? "تسک جدید در هر دوره ساخته شود." : "این تسک تکرار نمی‌شود."} checked={state.recurring} onChange={(v) => set("recurring", v)} />
          {state.recurring && (
            <div className="grid grid-cols-2 gap-2.5">
              <SelectField label="دوره تکرار" options={[{ value: "daily", label: "هر روز" }, { value: "weekly", label: "هر هفته" }, { value: "monthly", label: "هر ماه" }]} value={state.recurrence_type} onChange={(e) => set("recurrence_type", e.target.value as FormState["recurrence_type"])} />
              <DateField label="پایان تکرار" placeholder="بدون پایان" value={state.recurrence_end_date} onChange={(v) => set("recurrence_end_date", v)} error={fieldError(error, "recurrence_end_date")} />
            </div>
          )}
          <TextAreaField label="توضیحات" placeholder="شرح کار، خروجی مورد انتظار و نکات لازم را وارد کنید." value={state.description} onChange={(e) => set("description", e.target.value)} maxLength={4000} />
          {mode === "edit" && (
            <SelectField label="وضعیت" options={["todo", "in_progress", "completed", "cancelled"].map((s) => ({ value: s, label: TASK_STATUS[s].label }))} value={state.status} onChange={(e) => set("status", e.target.value)} />
          )}
          {state.recurring && state.recurrence_type === "monthly" && state.due_date && Number(jalaliParts(state.due_date, timezone).day) > 29 && (
            <p className="text-[11px] text-muted">در ماه‌های کوتاه‌تر، تسک در آخرین روز همان ماه ساخته می‌شود.</p>
          )}
        </form>
      )}
    </Modal>
  );
}
