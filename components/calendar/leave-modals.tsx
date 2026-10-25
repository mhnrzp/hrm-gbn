"use client";
// Figma 1:1306: «درخواست مرخصی», «بررسی و تأیید مرخصی», «رد درخواست مرخصی».
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, TriangleAlert } from "lucide-react";
import { Alert, Avatar, Badge, Button, LoadingState } from "@/components/ui/primitives";
import { DateField, ErrorState, Modal, SelectField, TextAreaField, Toggle } from "@/components/ui/controls";
import { api, ApiError, fieldError } from "@/lib/client-api";
import { addDays, dow } from "@/lib/calendar-dates";
import { faNumber, formatDate, formatDayMonth, formatStamp } from "@/lib/format";
import type { LeaveBalance } from "@/lib/services/calendar";
import type { MemberOption } from "@/lib/services/team";
import type { CalMe } from "./calendar-view";

type LeaveType = { id: string; code: string; name: string; deducts_balance: boolean };
type TaskConflict = { title: string; due_at: string; kind: string };

function workingDays(from: string, to: string, weekend: number[]) {
  if (!from || !to || to < from) return 0;
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (!weekend.includes(dow(d))) n++;
  return n;
}

export function LeaveRequestModal({ me, members, leaveTypes, myBalance, defaultEmployee, onClose, onSaved }: { me: CalMe; members: MemberOption[]; leaveTypes: LeaveType[]; myBalance: LeaveBalance | null; defaultEmployee?: string; onClose: () => void; onSaved: () => void }) {
  const isManager = me.role === "manager";
  const [employee, setEmployee] = useState(defaultEmployee ?? me.userId);
  const [typeId, setTypeId] = useState(leaveTypes.find((t) => t.code === "annual")?.id ?? leaveTypes[0]?.id ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [approveNow, setApproveNow] = useState(false);
  const [balance, setBalance] = useState<LeaveBalance | null>(employee === me.userId ? myBalance : null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ status: string; task_conflicts: TaskConflict[] } | null>(null);

  useEffect(() => {
    if (employee === me.userId) return;
    let alive = true;
    api<LeaveBalance>(`/leave-balance/${employee}`).then((b) => alive && setBalance(b)).catch(() => alive && setBalance(null));
    return () => {
      alive = false;
    };
  }, [employee, me.userId]);

  const days = workingDays(from, to || from, me.weekendDays);
  const type = leaveTypes.find((t) => t.id === typeId);
  const activeBalance = employee === me.userId ? myBalance : balance;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await api<{ status: string; task_conflicts: TaskConflict[] }>("/leave-requests", {
        body: { employee_id: employee, leave_type_id: typeId, start_date: from, end_date: to || from, reason, approve_now: isManager && approveNow },
      });
      if (res.task_conflicts.length) setResult(res);
      else onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  if (result) {
    return (
      <Modal open onClose={onSaved} title={result.status === "approved" ? "مرخصی ثبت شد" : "درخواست ارسال شد"} footer={<Button onClick={onSaved}>متوجه شدم</Button>}>
        <Alert tone="blue" title="پوشش کاری بررسی شود">
          در این بازه {faNumber(result.task_conflicts.length)} تسک برنامه‌ریزی‌شده وجود دارد: {result.task_conflicts.map((c) => `${c.title} (${formatDayMonth(c.due_at, me.timezone)})`).join("، ")}. مدیر هنگام بررسی این تداخل را می‌بیند.
        </Alert>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="درخواست مرخصی"
      subtitle={isManager && employee !== me.userId ? "ثبت مرخصی برای عضو تیم" : "ثبت درخواست برای بررسی مدیر"}
      footer={
        <>
          <Button type="submit" form="leave-form" disabled={pending}>
            {isManager && approveNow ? "ثبت مرخصی" : "ارسال درخواست"}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            انصراف
          </Button>
        </>
      }
    >
      <form id="leave-form" onSubmit={submit} className="flex flex-col gap-3">
        {error ? <Alert title={error instanceof ApiError ? error.messageFa : "ثبت انجام نشد."} /> : null}
        <SelectField label="کارمند" disabled={!isManager} options={members.map((m) => ({ value: m.user_id, label: m.full_name }))} value={employee} onChange={(e) => setEmployee(e.target.value)} />
        <SelectField label="نوع مرخصی" options={leaveTypes.map((t) => ({ value: t.id, label: t.name }))} value={typeId} onChange={(e) => setTypeId(e.target.value)} />
        <div className="grid grid-cols-2 gap-2.5">
          <DateField label="از تاریخ" required value={from} onChange={(v) => { setFrom(v); if (!to || to < v) setTo(v); }} error={fieldError(error, "start_date")} />
          <DateField label="تا تاریخ" required value={to} onChange={setTo} error={fieldError(error, "end_date")} />
        </div>
        {from && <Badge tone="red" className="self-start">مدت درخواست: {faNumber(days)} روز</Badge>}
        <TextAreaField label="دلیل درخواست" required value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} error={fieldError(error, "reason")} />
        {activeBalance && type?.deducts_balance && (
          <p className="text-[11px] text-muted">
            مانده مرخصی: {faNumber(Number(activeBalance.remaining_days))} روز • پس از تأیید: {faNumber(Number(activeBalance.remaining_days) - days)} روز
          </p>
        )}
        {isManager && (
          <Toggle
            label="ثبت مستقیم (بدون نیاز به تأیید)"
            description={employee === me.userId ? "مرخصی خودتان به‌عنوان استثنای مدیر در گزارش فعالیت ثبت می‌شود." : "مرخصی بلافاصله تأییدشده ثبت می‌شود."}
            checked={approveNow}
            onChange={setApproveNow}
          />
        )}
      </form>
    </Modal>
  );
}

type LeaveDetail = {
  id: string;
  employee_id: string;
  start_at: string;
  end_at: string;
  days_count: number;
  status: string;
  reason_private: string;
  created_at: string;
  leave_types: { name: string } | null;
  employee: { full_name: string } | null;
  busy: { items: { kind: string; title: string | null; start_at: string; end_at: string }[] } | null;
  balance: LeaveBalance | null;
};

export function LeaveReviewModal({ id, initialMode, tz, onClose, onSaved }: { id: string; initialMode: "approve" | "reject"; tz: string; onClose: () => void; onSaved: () => void }) {
  const [mode, setMode] = useState(initialMode);
  const [data, setData] = useState<LeaveDetail | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api<LeaveDetail>(`/leave-requests/${id}`).then(setData).catch(() => setLoadError(true));
  }, [id]);

  const taskItems = useMemo(() => (data?.busy?.items ?? []).filter((i) => i.kind !== "approved_leave"), [data]);

  async function decide(decision: "approve" | "reject") {
    setPending(true);
    setError(null);
    try {
      await api(`/leave-requests/${id}/review`, { body: { decision, comment: comment || undefined } });
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  if (loadError) return <Modal open onClose={onClose} title="بررسی مرخصی"><ErrorState /></Modal>;
  if (!data) return <Modal open onClose={onClose} title="بررسی مرخصی"><LoadingState /></Modal>;

  const endDay = new Date(new Date(data.end_at).getTime() - 1000).toISOString();
  const days = Number(data.days_count);
  const summary = (
    <>
      <div className="flex items-center gap-2">
        <Avatar name={data.employee?.full_name ?? ""} seed={data.employee_id} />
        <p className="text-xs font-bold">{data.employee?.full_name}</p>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span>
          {formatDayMonth(data.start_at, tz)} تا {formatDate(endDay, tz)}
        </span>
        <Badge tone="red">{faNumber(days)} روز</Badge>
      </div>
      <p className="text-xs">
        نوع: {data.leave_types?.name}
        {data.balance && ` • مانده مرخصی: ${faNumber(Number(data.balance.remaining_days))} روز`}
      </p>
      <p className="text-[11px] text-muted">دلیل: {data.reason_private}</p>
      <p className="text-[10px] text-muted">ثبت درخواست: {formatStamp(data.created_at, tz)}</p>
    </>
  );
  const errMsg = error instanceof ApiError ? error.messageFa : error ? "ثبت تصمیم انجام نشد." : null;

  if (mode === "reject") {
    return (
      <Modal
        open
        onClose={onClose}
        title="رد درخواست مرخصی"
        subtitle="حالت تصمیم مدیر"
        footer={
          <>
            <Button variant="danger" disabled={pending || !comment.trim()} onClick={() => decide("reject")}>
              ثبت رد درخواست
            </Button>
            <Button variant="secondary" onClick={onClose}>
              انصراف
            </Button>
          </>
        }
      >
        {errMsg && <Alert title={errMsg} />}
        {summary}
        <TextAreaField label="دلیل رد درخواست" required value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
        <Alert title="دلیل برای کارمند ارسال می‌شود">پس از ثبت، درخواست با وضعیت ردشده در تاریخچه باقی می‌ماند.</Alert>
        <Badge tone="red" className="self-start">پیش‌نمایش: ردشده</Badge>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="بررسی و تأیید مرخصی"
      subtitle="فقط مدیر مجموعه"
      footer={
        <>
          <Button icon={Check} disabled={pending || data.status !== "pending"} onClick={() => decide("approve")}>
            تأیید مرخصی
          </Button>
          <Button variant="secondary" disabled={data.status !== "pending"} onClick={() => setMode("reject")}>
            رد درخواست
          </Button>
        </>
      }
    >
      {errMsg && <Alert title={errMsg} />}
      <Badge tone={data.status === "pending" ? "amber" : "gray"} className="self-start">
        {data.status === "pending" ? "در انتظار تأیید" : "بررسی‌شده"}
      </Badge>
      {summary}
      {taskItems.length > 0 ? (
        <Alert tone="blue" icon={TriangleAlert} title="پوشش کاری بررسی شود">
          {taskItems.map((t) => t.title).join("، ")} در این بازه برنامه‌ریزی شده است. پس از تأیید، تسک‌ها تغییر نمی‌کنند؛ در صورت نیاز آن‌ها را جابه‌جا یا واگذار کنید.
        </Alert>
      ) : (
        <Alert tone="green" title="بدون تداخل با کارهای برنامه‌ریزی‌شده" />
      )}
      <TextAreaField label="یادداشت مدیر" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
      <p className="text-[11px] text-muted">پس از تأیید، {faNumber(days)} روز از مانده مرخصی کسر و برنامه تیم به‌روزرسانی می‌شود.</p>
    </Modal>
  );
}
