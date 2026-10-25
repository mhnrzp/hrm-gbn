"use client";
// Figma: «جزئیات تسک» drawer and «تسک تکمیل شد» state (1:1665).
import { useCallback, useEffect, useState } from "react";
import { CircleCheck, PencilLine, Send } from "lucide-react";
import { Alert, Avatar, Badge, Button, LoadingState } from "@/components/ui/primitives";
import { ErrorState, Modal, TextAreaField } from "@/components/ui/controls";
import { api, ApiError } from "@/lib/client-api";
import { PRIORITY, RECURRENCE_LABEL, TASK_STATUS } from "@/lib/labels";
import { faNumber, formatDate, formatPercent, formatStamp, formatTime } from "@/lib/format";
import type { Me } from "./tasks-view";

type Detail = {
  id: string;
  task_id: string;
  status: string;
  due_at: string;
  claimed_by: string | null;
  completed_at: string | null;
  is_overdue: boolean;
  progress_percent: number;
  tasks: { title: string; description: string; priority: string; assignment_mode: string; recurrence_type: string; is_active: boolean; created_by: string; creator: { full_name: string } | null };
  task_occurrence_assignees: { user_id: string; progress_percent: number; progress_status: string; profiles: { full_name: string; avatar_path: string | null } | null }[];
  task_updates: { id: string; update_type: string; body: string | null; metadata: Record<string, unknown> | null; created_at: string; author_id: string; author: { full_name: string } | null }[];
};

export function TaskDetailModal({ occurrenceId, me, onClose, onChanged, onEdit }: { occurrenceId: string; me: Me; onClose: () => void; onChanged: () => void; onEdit: (taskId: string, occurrenceId: string) => void }) {
  const [data, setData] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [progressOpen, setProgressOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressNote, setProgressNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);

  const load = useCallback(() => {
    api<Detail>(`/task-occurrences/${occurrenceId}`)
      .then((d) => {
        setLoadError(false);
        setData(d);
        setProgress(d.task_occurrence_assignees.find((a) => a.user_id === me.userId)?.progress_percent ?? d.progress_percent);
      })
      .catch(() => setLoadError(true));
  }, [occurrenceId, me.userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(action: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      after?.();
      load();
      onChanged();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.messageFa : "انجام نشد. دوباره تلاش کنید.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <Modal open onClose={onClose} title="جزئیات تسک">
        <ErrorState onRetry={load} />
      </Modal>
    );
  }
  if (!data) {
    return (
      <Modal open onClose={onClose} title="جزئیات تسک">
        <LoadingState />
      </Modal>
    );
  }

  const t = data.tasks;
  const mine = data.task_occurrence_assignees.find((a) => a.user_id === me.userId);
  const isManager = me.role === "manager";
  const closed = data.status === "completed" || data.status === "cancelled";
  const canClaim = t.assignment_mode === "team_pool" && !data.claimed_by && !closed;
  const canWork = !!mine && !closed;
  const status = data.is_overdue ? "overdue" : data.status;
  const comments = data.task_updates.filter((u) => u.body);

  if (justCompleted) {
    const completer = data.task_occurrence_assignees.find((a) => a.user_id === me.userId)?.profiles?.full_name ?? "شما";
    return (
      <Modal
        open
        onClose={onClose}
        title="تسک تکمیل شد"
        subtitle="حالت پس از تأیید تکمیل"
        width={520}
        footer={
          <>
            <Button onClick={() => setJustCompleted(false)}>مشاهده تسک</Button>
            <Button variant="secondary" onClick={onClose}>
              بازگشت به تسک‌ها
            </Button>
          </>
        }
      >
        <Alert tone="green" icon={CircleCheck} title={`${t.title} با موفقیت تکمیل شد.`}>
          وضعیت تسک به تکمیل‌شده تغییر کرد{t.creator ? ` و به ${t.creator.full_name} اطلاع داده شد.` : "."}
        </Alert>
        <div className="flex items-center justify-between text-xs">
          <span>
            {completer} • {data.completed_at ? `${formatDate(data.completed_at, me.timezone)}، ${formatTime(data.completed_at, me.timezone)}` : ""}
          </span>
          <Badge tone="green">تکمیل‌شده</Badge>
        </div>
        <p className="text-xs">پیشرفت نهایی: {formatPercent(100)}</p>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="جزئیات تسک"
      subtitle={t.recurrence_type !== "none" ? `${RECURRENCE_LABEL[t.recurrence_type]} • ${t.title}` : t.title}
      width={440}
      footer={
        <>
          {(canWork || (isManager && !closed)) && (
            <Button icon={CircleCheck} disabled={busy} onClick={() => run(() => api(`/task-occurrences/${data.id}/complete`, { method: "POST" }), () => setJustCompleted(true))}>
              تکمیل تسک
            </Button>
          )}
          {canClaim && (
            <Button disabled={busy} onClick={() => run(() => api(`/task-occurrences/${data.id}/claim`, { method: "POST" }))}>
              برداشتن تسک
            </Button>
          )}
          {isManager && t.is_active && (
            <Button variant="secondary" icon={PencilLine} onClick={() => onEdit(data.task_id, data.id)}>
              ویرایش
            </Button>
          )}
        </>
      }
    >
      {actionError && <Alert title={actionError} />}
      <div className="flex items-center justify-between">
        <Badge tone={TASK_STATUS[status].tone}>{TASK_STATUS[status].label}</Badge>
        <Badge tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Badge>
      </div>
      <h3 className="text-lg font-bold leading-[1.7]">{t.title}</h3>

      {data.task_occurrence_assignees.length === 0 ? (
        <Badge tone="purple">صف تیم — هنوز کسی برنداشته است</Badge>
      ) : (
        data.task_occurrence_assignees.map((a) => (
          <div key={a.user_id} className="flex items-center gap-2.5">
            <Avatar name={a.profiles?.full_name ?? ""} seed={a.user_id} />
            <div className="text-xs leading-[1.6]">
              <p className="font-bold">{a.profiles?.full_name}</p>
              <p className="text-muted">مسئول تسک{data.task_occurrence_assignees.length > 1 ? ` • ${formatPercent(a.progress_percent)}` : ""}</p>
            </div>
          </div>
        ))
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <span className={data.is_overdue ? "text-danger" : ""}>
          {formatDate(data.due_at, me.timezone)} • {formatTime(data.due_at, me.timezone)}
        </span>
        {t.creator && <span className="text-muted">ایجادکننده: {t.creator.full_name}</span>}
      </div>
      {t.description && <p className="text-xs leading-[1.8] whitespace-pre-line">{t.description}</p>}

      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold">میزان پیشرفت</span>
          <span className="font-bold text-brand">{formatPercent(data.progress_percent)}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-blue" role="progressbar" aria-valuenow={data.progress_percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-brand" style={{ width: `${data.progress_percent}%` }} />
        </div>
        {canWork && !progressOpen && (
          <Button variant="secondary" className="self-start" onClick={() => setProgressOpen(true)}>
            ثبت به‌روزرسانی پیشرفت
          </Button>
        )}
        {canWork && progressOpen && (
          <div className="flex flex-col gap-2 rounded-ctl bg-app p-3">
            <label className="flex items-center gap-3 text-xs">
              <input type="range" min={0} max={100} step={5} value={progress} onChange={(e) => setProgress(Number(e.target.value))} className="flex-1 accent-brand" aria-label="درصد پیشرفت" />
              <span className="w-10 font-bold text-brand">{formatPercent(progress)}</span>
            </label>
            <TextAreaField label="توضیح کوتاه (اختیاری)" rows={2} value={progressNote} onChange={(e) => setProgressNote(e.target.value)} maxLength={2000} />
            <div className="flex gap-2">
              <Button disabled={busy} onClick={() => run(() => api(`/task-occurrences/${data.id}`, { method: "PATCH", body: { progress_percent: progress, note: progressNote || undefined } }), () => { setProgressOpen(false); setProgressNote(""); })}>
                ثبت پیشرفت
              </Button>
              <Button variant="secondary" onClick={() => setProgressOpen(false)}>
                انصراف
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <h4 className="text-[13px] font-bold">گفتگو و به‌روزرسانی‌ها</h4>
        {comments.length === 0 && <p className="text-[11px] text-muted">هنوز گفتگویی ثبت نشده است.</p>}
        {comments.map((u) => (
          <div key={u.id} className="flex flex-col gap-1.5 rounded-ctl bg-app p-3">
            <div className="flex items-center gap-2">
              <Avatar name={u.author?.full_name ?? ""} seed={u.author_id} size={28} />
              <span className="text-xs font-bold">{u.author?.full_name}</span>
              {u.update_type === "progress" && typeof u.metadata?.progress_percent === "number" && <Badge tone="blue">{formatPercent(u.metadata.progress_percent)}</Badge>}
            </div>
            <p className="text-xs leading-[1.8] whitespace-pre-line">{u.body}</p>
            <p className="text-[10px] text-muted">{formatStamp(u.created_at, me.timezone)}</p>
          </div>
        ))}
        {(mine || isManager) && (
          <>
            <TextAreaField label="نظر شما" placeholder="نظر خود را بنویسید..." rows={3} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} />
            <Button variant="secondary" icon={Send} className="self-start" disabled={busy || !comment.trim()} onClick={() => run(() => api(`/task-occurrences/${data.id}/comments`, { body: { body: comment } }), () => setComment(""))}>
              ارسال نظر
            </Button>
          </>
        )}
      </div>
      {data.task_occurrence_assignees.length > 1 && (
        <p className="text-[10px] text-muted">{faNumber(data.task_occurrence_assignees.filter((a) => a.progress_status === "completed").length)} از {faNumber(data.task_occurrence_assignees.length)} نفر کار خود را تکمیل کرده‌اند.</p>
      )}
    </Modal>
  );
}
