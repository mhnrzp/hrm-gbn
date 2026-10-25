"use client";
// Figma 1:1306 «افزودن زمان آزاد».
import { useEffect, useState, type FormEvent } from "react";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { Alert, Button, LoadingState } from "@/components/ui/primitives";
import { DateField, Modal, SelectField, TextAreaField, TimeField, Toggle } from "@/components/ui/controls";
import { api, ApiError, fieldError } from "@/lib/client-api";
import { jalaliParts, faNumber } from "@/lib/format";
import type { MemberOption } from "@/lib/services/team";
import type { CalMe } from "./calendar-view";

type Check = { status: "approved_leave" | "already_scheduled_work" | "available" | "no_declared_availability"; items: { title: string | null; kind: string }[] };

/** "YYYY-MM-DD" + "HH:MM" in the org zone → ISO instant (browser computes the offset for that zone). */
function zonedInstant(date: string, time: string, tz: string) {
  const guess = new Date(`${date}T${time}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(guess.getTime() - (asUtc - guess.getTime())).toISOString();
}
export { zonedInstant };

export function AvailabilityModal({ me, members, ruleId, defaultEmployee, defaultDate, onClose, onSaved }: { me: CalMe; members: MemberOption[]; ruleId?: string; defaultEmployee?: string; defaultDate: string; onClose: () => void; onSaved: () => void }) {
  const isManager = me.role === "manager";
  const [employee, setEmployee] = useState(defaultEmployee ?? me.userId);
  const [date, setDate] = useState(defaultDate);
  const [start, setStart] = useState("13:00");
  const [end, setEnd] = useState("16:00");
  const [weekly, setWeekly] = useState(false);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(!!ruleId);
  const [check, setCheck] = useState<Check | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!ruleId) return;
    api<{ items: { id: string; employee_id: string; start_date: string; start_time: string; end_time: string; recurrence_type: string; note: string }[] }>(
      `/availability${defaultEmployee ? `?employee_id=${defaultEmployee}` : ""}`,
    )
      .then(({ items }) => {
        const r = items.find((x) => x.id === ruleId);
        if (r) {
          setEmployee(r.employee_id);
          setDate(r.start_date);
          setStart(r.start_time.slice(0, 5));
          setEnd(r.end_time.slice(0, 5));
          setWeekly(r.recurrence_type === "weekly");
          setNote(r.note);
        }
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [ruleId, defaultEmployee]);

  // Live conflict check (self or manager) — «این بازه بدون تداخل است».
  useEffect(() => {
    if (!date || !start || !end || end <= start) return;
    let alive = true;
    const t = setTimeout(() => {
      api<Check>(`/availability/check?user_id=${employee}&start=${encodeURIComponent(zonedInstant(date, start, me.timezone))}&end=${encodeURIComponent(zonedInstant(date, end, me.timezone))}`)
        .then((c) => alive && setCheck(c))
        .catch(() => alive && setCheck(null));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [employee, date, start, end, me.timezone]);

  const hours = (() => {
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    const mins = (eh * 60 + em - (sh * 60 + sm) + 1440) % 1440;
    return Math.round((mins / 60) * 10) / 10;
  })();
  const name = members.find((m) => m.user_id === employee)?.full_name.split(" ")[0] ?? "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const body = { start_date: date, start_time: start, end_time: end, recurrence_type: weekly ? "weekly" : "none", note };
    try {
      if (ruleId) await api(`/availability/${ruleId}`, { method: "PATCH", body });
      else await api("/availability", { body: { ...body, employee_id: employee } });
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!ruleId || !window.confirm("این زمان آزاد حذف شود؟")) return;
    try {
      await api(`/availability/${ruleId}`, { method: "DELETE" });
      onSaved();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={ruleId ? "ویرایش زمان آزاد" : "افزودن زمان آزاد"}
      subtitle="اعلام زمان قابل رزرو برای تیم"
      footer={
        <>
          <Button type="submit" form="availability-form" disabled={pending || loading}>
            ثبت زمان آزاد
          </Button>
          <Button variant="secondary" onClick={onClose}>
            انصراف
          </Button>
          {ruleId && (
            <Button variant="ghost" className="text-danger" onClick={remove}>
              حذف
            </Button>
          )}
        </>
      }
    >
      {loading ? (
        <LoadingState />
      ) : (
        <form id="availability-form" onSubmit={submit} className="flex flex-col gap-3">
          {error ? <Alert title={error instanceof ApiError ? error.messageFa : "ثبت انجام نشد."} /> : null}
          <SelectField label="کارمند" disabled={!isManager || !!ruleId} options={members.map((m) => ({ value: m.user_id, label: m.full_name }))} value={employee} onChange={(e) => setEmployee(e.target.value)} />
          <DateField label="تاریخ" required value={date} onChange={setDate} />
          <div className="grid grid-cols-2 gap-2.5">
            <TimeField label="از ساعت" value={start} onChange={(e) => setStart(e.target.value)} />
            <TimeField label="تا ساعت" value={end} onChange={(e) => setEnd(e.target.value)} error={fieldError(error, "end_time")} />
          </div>
          <Toggle label="تکرار هفتگی" description={date ? `هر ${jalaliParts(date, "UTC").weekday} در همین ساعت` : undefined} checked={weekly} onChange={setWeekly} />
          <TextAreaField label="توضیحات" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          {check?.status === "available" || check?.status === "no_declared_availability" ? (
            <Alert tone="green" icon={CircleCheck} title="این بازه بدون تداخل است">
              {faNumber(hours)} ساعت زمان آزاد به برنامه {name} اضافه می‌شود.
            </Alert>
          ) : check ? (
            <Alert tone="amber" icon={TriangleAlert} title={check.status === "approved_leave" ? "این بازه با مرخصی تأییدشده هم‌پوشانی دارد" : "این بازه با کار برنامه‌ریزی‌شده هم‌پوشانی دارد"}>
              {check.items.map((i) => i.title ?? "مرخصی").join("، ")} — زمان آزاد ثبت می‌شود اما در تقویم، بخش هم‌پوشان آزاد نمایش داده نمی‌شود.
            </Alert>
          ) : null}
        </form>
      )}
    </Modal>
  );
}
