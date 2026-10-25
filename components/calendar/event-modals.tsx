"use client";
// Figma 1:1306: «جزئیات رویداد», «تداخل در زمان‌بندی»; event form (not drawn in Figma, same primitives).
import { useEffect, useState, type FormEvent } from "react";
import { TriangleAlert } from "lucide-react";
import { Alert, Avatar, Badge, Button, LoadingState, cn } from "@/components/ui/primitives";
import { DateField, ErrorState, FieldShell, Modal, TextAreaField, TextField, TimeField } from "@/components/ui/controls";
import { api, ApiError, fieldError } from "@/lib/client-api";
import { faNumber, formatDate, formatDateWithWeekday, formatTime, localIsoDate } from "@/lib/format";
import type { MemberOption } from "@/lib/services/team";
import { zonedInstant } from "./availability-modal";

type ConflictItem = { kind: string; title: string | null; start_at: string; end_at: string };
type SaveResult = { saved: boolean; event_id?: string; conflicts: { user_id: string; full_name: string; items: ConflictItem[] }[]; suggested?: { start_at: string; end_at: string } | null };
type EventData = {
  id: string;
  title: string;
  description: string;
  location: string;
  start_at: string;
  end_at: string;
  organizer: { full_name: string } | null;
  calendar_event_attendees: { user_id: string; profiles: { full_name: string } | null }[];
  conflicts: { user_id: string; items: ConflictItem[] }[];
};

export function EventFormModal({ eventId, defaultDate, members, tz, onClose, onSaved }: { eventId?: string; defaultDate: string; members: MemberOption[]; tz: string; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("11:00");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [attendees, setAttendees] = useState<string[]>([]);
  const [loading, setLoading] = useState(!!eventId);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState<SaveResult | null>(null);

  useEffect(() => {
    if (!eventId) return;
    api<EventData>(`/calendar-events/${eventId}`)
      .then((e) => {
        setTitle(e.title);
        setDate(localIsoDate(new Date(e.start_at), tz));
        setStart(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(e.start_at)));
        setEnd(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(e.end_at)));
        setLocation(e.location);
        setDescription(e.description);
        setAttendees(e.calendar_event_attendees.map((a) => a.user_id));
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [eventId, tz]);

  async function save(force = false, override?: { start_at: string; end_at: string }) {
    setPending(true);
    setError(null);
    const body = {
      title,
      description,
      location,
      start_at: override?.start_at ?? zonedInstant(date, start, tz),
      end_at: override?.end_at ?? zonedInstant(date, end, tz),
      attendee_ids: attendees,
      force,
    };
    try {
      const res = await api<SaveResult>(eventId ? `/calendar-events/${eventId}` : "/calendar-events", { method: eventId ? "PATCH" : "POST", body });
      if (!res.saved) setConflict(res);
      else onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  if (conflict) {
    const first = conflict.conflicts[0];
    const count = conflict.conflicts.reduce((n, c) => n + c.items.length, 0) + 1;
    return (
      <Modal
        open
        onClose={() => setConflict(null)}
        title="تداخل در زمان‌بندی"
        subtitle="پیش از ذخیره رویداد بررسی کنید."
        footer={
          <>
            {conflict.suggested && (
              <Button disabled={pending} onClick={() => save(false, conflict.suggested!)}>
                تغییر زمان جلسه
              </Button>
            )}
            <Button variant="secondary" onClick={() => setConflict(null)}>
              انصراف
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => save(true)}>
              ذخیره با وجود تداخل
            </Button>
          </>
        }
      >
        <Alert icon={TriangleAlert} title={`${faNumber(count)} رویداد همزمان برای ${first.full_name}`}>
          {formatDateWithWeekday(zonedInstant(date, start, tz), tz)}، ساعت {formatTime(zonedInstant(date, start, tz), tz)} تا {formatTime(zonedInstant(date, end, tz), tz)}
        </Alert>
        {conflict.conflicts.flatMap((c) =>
          c.items.map((i, idx) => (
            <div key={`${c.user_id}-${idx}`} className={cn("flex flex-col gap-1 rounded-ctl p-3.5", i.kind === "meeting" ? "bg-tint-purple" : i.kind === "approved_leave" ? "bg-tint-red" : "bg-surface-blue")}>
              <span className={cn("text-[11px]", i.kind === "meeting" ? "text-purple" : i.kind === "approved_leave" ? "text-danger" : "text-brand")}>
                {i.kind === "meeting" ? "جلسه" : i.kind === "approved_leave" ? "مرخصی" : "تسک"}
              </span>
              <span className="text-xs font-bold">{i.title ?? `مرخصی ${c.full_name}`}</span>
              <span className="text-[11px]">
                {formatDate(i.start_at, tz)} • {formatTime(i.start_at, tz)} تا {formatTime(i.end_at, tz)}
              </span>
            </div>
          )),
        )}
        {conflict.suggested ? (
          <FieldShell label="زمان پیشنهادی بدون تداخل">
            <span className="text-xs">
              {formatDate(conflict.suggested.start_at, tz)}، {formatTime(conflict.suggested.start_at, tz)} تا {formatTime(conflict.suggested.end_at, tz)}
            </span>
          </FieldShell>
        ) : (
          <p className="text-[11px] text-muted">در هفت روز آینده زمان مشترک بدون تداخلی پیدا نشد.</p>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={eventId ? "ویرایش رویداد" : "افزودن رویداد"}
      subtitle="جلسه با اعضای تیم"
      footer={
        <>
          <Button type="submit" form="event-form" disabled={pending || loading}>
            ذخیره رویداد
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
        <form
          id="event-form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            save();
          }}
          className="flex flex-col gap-3"
        >
          {error ? <Alert title={error instanceof ApiError ? error.messageFa : "ذخیره انجام نشد."} /> : null}
          <TextField label="عنوان" required value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} error={fieldError(error, "title")} />
          <DateField label="تاریخ" required value={date} onChange={setDate} />
          <div className="grid grid-cols-2 gap-2.5">
            <TimeField label="از ساعت" value={start} onChange={(e) => setStart(e.target.value)} />
            <TimeField label="تا ساعت" value={end} onChange={(e) => setEnd(e.target.value)} error={fieldError(error, "end_at")} />
          </div>
          <FieldShell label="شرکت‌کنندگان" required error={fieldError(error, "attendee_ids")}>
            <div className="flex flex-wrap gap-2 py-1">
              {members.map((m) => {
                const on = attendees.includes(m.user_id);
                return (
                  <button key={m.user_id} type="button" aria-pressed={on} onClick={() => setAttendees((a) => (on ? a.filter((x) => x !== m.user_id) : [...a, m.user_id]))}>
                    <Badge tone={on ? "purple" : "gray"}>{m.full_name}</Badge>
                  </button>
                );
              })}
            </div>
          </FieldShell>
          <TextField label="محل برگزاری" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} />
          <TextAreaField label="توضیحات" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </form>
      )}
    </Modal>
  );
}

export function EventDetailModal({ id, tz, canEdit, onClose, onEdit, onChanged }: { id: string; tz: string; canEdit: boolean; onClose: () => void; onEdit: () => void; onChanged: () => void }) {
  const [data, setData] = useState<EventData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<EventData>(`/calendar-events/${id}`).then(setData).catch(() => setLoadError(true));
  }, [id]);

  async function cancel() {
    if (!window.confirm("این رویداد حذف شود؟ به شرکت‌کنندگان اطلاع داده می‌شود.")) return;
    try {
      await api(`/calendar-events/${id}`, { method: "DELETE" });
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.messageFa : "حذف انجام نشد.");
    }
  }

  if (loadError) return <Modal open onClose={onClose} title="جزئیات رویداد"><ErrorState /></Modal>;
  if (!data) return <Modal open onClose={onClose} title="جزئیات رویداد"><LoadingState /></Modal>;
  const mins = Math.round((new Date(data.end_at).getTime() - new Date(data.start_at).getTime()) / 60000);
  const duration = mins % 60 === 0 ? `${faNumber(mins / 60)} ساعت` : `${faNumber(mins)} دقیقه`;

  return (
    <Modal
      open
      onClose={onClose}
      title="جزئیات رویداد"
      subtitle="پنل تقویم"
      footer={
        canEdit && (
          <>
            <Button onClick={onEdit}>ویرایش زمان</Button>
            <Button variant="secondary" onClick={cancel}>
              حذف رویداد
            </Button>
          </>
        )
      }
    >
      {error && <Alert title={error} />}
      <Badge tone="purple" className="self-start">جلسه</Badge>
      <h3 className="text-lg font-bold">{data.title}</h3>
      {data.calendar_event_attendees.map((a) => (
        <div key={a.user_id} className="flex items-center gap-2">
          <Avatar name={a.profiles?.full_name ?? ""} seed={a.user_id} />
          <div className="text-xs leading-[1.6]">
            <p className="font-bold">{a.profiles?.full_name}</p>
            {data.organizer && <p className="text-muted">برگزارکننده: {data.organizer.full_name}</p>}
          </div>
        </div>
      ))}
      <div className="flex flex-col gap-2 border-t border-line pt-4 text-xs">
        <p>{formatDateWithWeekday(data.start_at, tz)}</p>
        <p>
          ساعت {formatTime(data.start_at, tz)} تا {formatTime(data.end_at, tz)} • مدت {duration}
        </p>
        {data.location && <p>محل برگزاری: {data.location}</p>}
        {data.description && <p className="text-muted">{data.description}</p>}
      </div>
      {data.conflicts.length > 0 && (
        <Alert tone="amber" title="این رویداد تداخل دارد">
          با {data.conflicts.flatMap((c) => c.items.map((i) => (i.kind === "approved_leave" ? "مرخصی تأییدشده" : `زمان ${i.title}`))).join("، ")} هم‌پوشانی دارد.
        </Alert>
      )}
    </Modal>
  );
}
