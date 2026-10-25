"use client";
// Figma: تنظیمات (1:2194), mobile (1:361).
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlarmClock, Bell, Building2, CalendarDays, Check, Globe, History, Palette, ShieldCheck, Sun, UserRound } from "lucide-react";
import { Alert, Avatar, Badge, Button, Card, CardHeader, PageTitle, cn } from "@/components/ui/primitives";
import { FieldShell, Modal, SelectField, TextField, Toggle } from "@/components/ui/controls";
import { api, ApiError, fieldError } from "@/lib/client-api";
import { createClient } from "@/lib/supabase/browser";
import { faDigits, faNumber, formatStamp } from "@/lib/format";
import { auditSentence } from "@/lib/audit-text";
import type { AuditEntry, CompanySettings, Preferences } from "@/lib/services/settings";
import { uploadAvatar } from "@/components/team/member-modals";

type Settings = {
  role: "manager" | "employee";
  profile: { full_name: string; avatar_path: string | null; email: string; phone: string | null };
  preferences: Partial<Preferences>;
  company: Partial<CompanySettings>;
  access?: { managers: number; employees: number };
};

const SECTIONS = [
  { id: "company", label: "اطلاعات مجموعه", icon: Building2, manager: true },
  { id: "account", label: "تنظیمات حساب کاربری", icon: UserRound },
  { id: "access", label: "مدیریت دسترسی‌ها", icon: ShieldCheck, manager: true },
  { id: "notifications", label: "تنظیمات اعلان‌ها", icon: Bell },
  { id: "reminders", label: "یادآوری‌ها", icon: AlarmClock },
  { id: "calendar", label: "تنظیمات تقویم", icon: CalendarDays },
  { id: "appearance", label: "ظاهر برنامه", icon: Sun },
  { id: "activity", label: "گزارش فعالیت‌ها", icon: History, manager: true },
];

const WEEK_STARTS = [
  { value: "6", label: "شنبه" },
  { value: "0", label: "یکشنبه" },
  { value: "1", label: "دوشنبه" },
];
const TIMEZONES = [
  { value: "Asia/Tehran", label: "تهران، ‎+۰۳:۳۰" },
  { value: "Asia/Dubai", label: "دبی، ‎+۰۴:۰۰" },
  { value: "Europe/Istanbul", label: "استانبول، ‎+۰۳:۰۰" },
  { value: "Europe/Berlin", label: "برلین (اروپای مرکزی)" },
  { value: "Europe/London", label: "لندن" },
  { value: "UTC", label: "UTC" },
];

const PERMISSIONS: [string, string, string][] = [
  ["داشبورد", "همه داده‌های تیم", "تسک‌ها و اعلان‌های خود"],
  ["تسک‌ها", "ایجاد، تخصیص، ویرایش و بایگانی", "پیشرفت، نظر و تکمیل تسک‌های خود"],
  ["صورت‌حساب‌ها و پرداخت‌ها", "دسترسی کامل", "بدون دسترسی"],
  ["تقویم تیم", "همه رویدادها و درخواست‌ها", "مرخصی تأییدشده و زمان آزاد (بدون دلیل)"],
  ["مرخصی", "تأیید یا رد درخواست‌ها", "ثبت و لغو درخواست خود"],
  ["کارمندان", "دعوت، ویرایش، غیرفعال‌سازی", "فهرست عمومی اعضا"],
  ["تنظیمات مجموعه و گزارش فعالیت", "دسترسی کامل", "بدون دسترسی"],
];

export function SettingsView({ settings, audit, avatarUrl, me }: { settings: Settings; audit: AuditEntry[]; avatarUrl: string | null; me: { userId: string; orgId: string; role: "manager" | "employee"; timezone: string; jobTitle: string } }) {
  const router = useRouter();
  const isManager = me.role === "manager";
  const [company, setCompany] = useState(settings.company);
  const [profile, setProfile] = useState(settings.profile);
  const [prefs, setPrefs] = useState(settings.preferences);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [modal, setModal] = useState<"password" | "permissions" | "audit" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const diff = <T extends object>(a: T, b: T) => Object.fromEntries(Object.entries(a).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify((b as Record<string, unknown>)[k])));
  const companyPatch = isManager ? diff(company, settings.company) : {};
  const profilePatch = diff({ full_name: profile.full_name, phone: profile.phone ?? "" }, { full_name: settings.profile.full_name, phone: settings.profile.phone ?? "" });
  const prefsPatch = diff(prefs, settings.preferences);
  const dirty = Object.keys(companyPatch).length + Object.keys(profilePatch).length + Object.keys(prefsPatch).length > 0;

  async function save() {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      if (Object.keys(companyPatch).length) await api("/settings/company", { method: "PATCH", body: companyPatch });
      if (Object.keys(profilePatch).length) await api("/settings/profile", { method: "PATCH", body: profilePatch });
      if (Object.keys(prefsPatch).length) await api("/settings/notifications", { method: "PATCH", body: prefsPatch });
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }

  function reset() {
    setCompany(settings.company);
    setProfile(settings.profile);
    setPrefs(settings.preferences);
    setError(null);
  }

  async function changeAvatar(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const path = await uploadAvatar(me.orgId, me.userId, file);
      await api("/settings/profile", { method: "PATCH", body: { avatar_path: path } });
      router.refresh();
    } catch (e) {
      setError(e);
    }
  }

  const pref = (k: keyof Preferences) => !!prefs[k];
  const setPref = (k: keyof Preferences) => (v: boolean) => setPrefs((p) => ({ ...p, [k]: v }));
  const errMsg = error instanceof ApiError ? error.messageFa : error ? "ذخیره انجام نشد." : null;
  const sections = SECTIONS.filter((s) => !s.manager || isManager);

  return (
    <>
      <PageTitle
        title="تنظیمات"
        subtitle="مدیریت مجموعه، حساب کاربری و ترجیحات برنامه"
        actions={
          <>
            <Button icon={Check} disabled={!dirty || pending} onClick={save}>ذخیره تغییرات</Button>
            <Button variant="secondary" disabled={!dirty} onClick={reset}>انصراف</Button>
          </>
        }
      />
      {errMsg && <Alert title={errMsg} />}
      {saved && !dirty && <Alert tone="green" title="تغییرات ذخیره شد." />}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_190px]">
        <div className="flex min-w-0 flex-col gap-4 lg:order-1">
          {isManager && (
            <Card id="company">
              <CardHeader title="اطلاعات مجموعه" />
              <div className="grid gap-3 p-[18px] pt-0 md:grid-cols-2">
                <TextField label="نام مجموعه" value={company.name ?? ""} onChange={(e) => setCompany((c) => ({ ...c, name: e.target.value }))} error={fieldError(error, "name")} />
                <TextField label="شناسه مجموعه" value={company.registration_code ?? ""} onChange={(e) => setCompany((c) => ({ ...c, registration_code: e.target.value }))} />
                <TextField label="ایمیل مجموعه" dir="ltr" type="email" value={company.email ?? ""} onChange={(e) => setCompany((c) => ({ ...c, email: e.target.value }))} error={fieldError(error, "email")} />
                <TextField label="شماره تماس" dir="ltr" value={company.phone ?? ""} onChange={(e) => setCompany((c) => ({ ...c, phone: e.target.value }))} error={fieldError(error, "phone")} />
                <TextField label="آدرس" className="md:col-span-2" value={company.address ?? ""} onChange={(e) => setCompany((c) => ({ ...c, address: e.target.value }))} />
              </div>
            </Card>
          )}

          <Card id="account">
            <CardHeader title="تنظیمات حساب کاربری" />
            <div className="flex flex-col gap-3 p-[18px] pt-0">
              <div className="flex flex-wrap items-center gap-3">
                <Avatar name={profile.full_name} seed={me.userId} src={avatarUrl} size={40} />
                <div className="text-xs">
                  <p className="font-bold">{profile.full_name}</p>
                  <p className="text-muted">{me.jobTitle || (isManager ? "مدیر مجموعه" : "کارمند")}</p>
                </div>
                <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => changeAvatar(e.target.files?.[0])} />
                <Button variant="secondary" onClick={() => fileInput.current?.click()}>تغییر تصویر</Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <TextField label="نام و نام خانوادگی" value={profile.full_name} onChange={(e) => setProfile((p) => ({ ...p, full_name: e.target.value }))} error={fieldError(error, "full_name")} />
                <FieldShell label="ایمیل"><span className="ltr text-xs">{profile.email}</span></FieldShell>
                <TextField label="شماره موبایل" dir="ltr" value={profile.phone ?? ""} onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))} error={fieldError(error, "phone")} />
              </div>
              <Button variant="secondary" className="self-start" onClick={() => setModal("password")}>تغییر رمز عبور</Button>
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card id="notifications">
              <CardHeader title="تنظیمات اعلان‌ها" />
              <div className="px-[18px] pb-2">
                <Toggle label="اعلان‌های درون برنامه" checked={pref("in_app_enabled")} onChange={setPref("in_app_enabled")} description="اعلان‌های حیاتی (تخصیص تسک، تصمیم مرخصی، سررسید گذشته) همیشه ارسال می‌شوند." />
                <Toggle label="اعلان ایمیلی" checked={pref("email_enabled")} onChange={setPref("email_enabled")} description="پس از راه‌اندازی سرویس ایمیل مجموعه فعال می‌شود." />
                <Toggle label="درخواست‌های مرخصی" checked={pref("notify_leave_requests")} onChange={setPref("notify_leave_requests")} />
                <Toggle label="تغییر وضعیت تسک" checked={pref("notify_task_status")} onChange={setPref("notify_task_status")} />
              </div>
            </Card>
            <Card id="reminders">
              <CardHeader title="یادآوری‌ها" />
              <div className="px-[18px] pb-2">
                <Toggle label="یادآوری موعد تسک" description={`${prefs.task_reminder_days === 1 ? "یک" : faNumber(prefs.task_reminder_days ?? 1)} روز پیش از سررسید`} checked={pref("task_reminder_enabled")} onChange={setPref("task_reminder_enabled")} />
                {isManager && (
                  <Toggle label="یادآوری پرداخت" description={`${prefs.invoice_reminder_days === 3 ? "سه" : faNumber(prefs.invoice_reminder_days ?? 3)} روز پیش از سررسید`} checked={pref("invoice_reminder_enabled")} onChange={setPref("invoice_reminder_enabled")} />
                )}
                {isManager && <Toggle label="خلاصه هفتگی تیم" description={`شنبه‌ها، ساعت ${faDigits("08:00")}`} checked={pref("weekly_digest_enabled")} onChange={setPref("weekly_digest_enabled")} />}
              </div>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card id="calendar">
              <CardHeader title="تنظیمات تقویم" />
              <div className="flex flex-col gap-3 p-[18px] pt-0">
                <FieldShell label="نوع تقویم" icon={<CalendarDays size={16} />}><span className="text-xs">هجری شمسی</span></FieldShell>
                <SelectField label="آغاز هفته" disabled={!isManager} options={WEEK_STARTS} value={String(company.week_start ?? 6)} onChange={(e) => setCompany((c) => ({ ...c, week_start: Number(e.target.value) }))} />
                <SelectField label="منطقه زمانی" disabled={!isManager} options={TIMEZONES} value={company.timezone ?? me.timezone} onChange={(e) => setCompany((c) => ({ ...c, timezone: e.target.value }))} />
              </div>
            </Card>
            <Card id="appearance">
              <CardHeader title="ظاهر برنامه" />
              <div className="flex flex-col gap-3 p-[18px] pt-0">
                <FieldShell label="زبان برنامه" icon={<Globe size={16} />}><span className="text-xs">فارسی</span></FieldShell>
                <FieldShell label="پوسته" icon={<Palette size={16} />}><span className="text-xs">روشن</span></FieldShell>
                <Toggle label="نمایش فشرده جدول‌ها" checked={pref("compact_tables")} onChange={setPref("compact_tables")} />
              </div>
            </Card>
          </div>

          {isManager && settings.access && (
            <Card id="access">
              <CardHeader title="مدیریت دسترسی‌ها" />
              <div className="flex flex-col gap-3 p-[18px] pt-0 text-xs">
                <div className="flex items-center justify-between border-b border-line pb-3">
                  <span>مدیر • دسترسی کامل به همه بخش‌ها</span>
                  <Badge tone="purple">{faNumber(settings.access.managers)} عضو</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span>کارمند • تسک‌ها و برنامه شخصی</span>
                  <Badge tone="gray">{faNumber(settings.access.employees)} عضو</Badge>
                </div>
                <Button variant="secondary" className="self-start" onClick={() => setModal("permissions")}>ویرایش مجوزها</Button>
              </div>
            </Card>
          )}

          {isManager && (
            <Card id="activity">
              <CardHeader title="گزارش فعالیت‌ها" />
              <div className="flex flex-col gap-3 px-[18px] pb-2 text-xs">
                {audit.length === 0 && <p className="text-muted">فعالیتی ثبت نشده است.</p>}
                {audit.map((e) => (
                  <div key={e.id} className="flex items-center justify-between gap-3 border-b border-line pb-3 last:border-0">
                    <span>{auditSentence(e)}</span>
                    <span className="shrink-0 text-[10px] text-muted">{formatStamp(e.created_at, me.timezone)}</span>
                  </div>
                ))}
              </div>
              <div className="p-2.5">
                <Button variant="ghost" onClick={() => setModal("audit")}>مشاهده گزارش کامل</Button>
              </div>
            </Card>
          )}
        </div>

        <nav aria-label="بخش‌های تنظیمات" className="hidden flex-col gap-1 rounded-card border border-line bg-card p-2 lg:sticky lg:top-24 lg:order-2 lg:flex">
          {sections.map((s) => (
            <a key={s.id} href={`#${s.id}`} className={cn("flex items-center gap-2.5 rounded-ctl px-3 py-2.5 text-xs text-muted hover:bg-app")}>
              <s.icon size={16} aria-hidden />
              {s.label}
            </a>
          ))}
        </nav>
      </div>

      {modal === "password" && <PasswordModal onClose={() => setModal(null)} />}
      {modal === "permissions" && (
        <Modal open onClose={() => setModal(null)} title="مجوزهای نقش‌ها" subtitle="در نسخه فعلی، نقش‌ها ثابت هستند." width={640}>
          <table className="w-full text-right text-[11px]">
            <thead>
              <tr className="bg-app text-muted">
                <th className="p-2">بخش</th>
                <th className="p-2">مدیر</th>
                <th className="p-2">کارمند</th>
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map(([area, m, e]) => (
                <tr key={area} className="border-b border-line">
                  <td className="p-2 font-bold">{area}</td>
                  <td className="p-2">{m}</td>
                  <td className="p-2">{e}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-muted">برای تغییر نقش هر عضو، از صفحه کارمندان «ویرایش اطلاعات» را انتخاب کنید.</p>
        </Modal>
      )}
      {modal === "audit" && <AuditModal timezone={me.timezone} onClose={() => setModal(null)} />}
    </>
  );
}

function PasswordModal({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    if (password.length < 8) return setMessage({ ok: false, text: "رمز عبور باید حداقل ۸ نویسه باشد." });
    if (password !== confirm) return setMessage({ ok: false, text: "تکرار رمز عبور یکسان نیست." });
    setPending(true);
    const { error } = await createClient().auth.updateUser({ password });
    setPending(false);
    if (error) setMessage({ ok: false, text: error.code === "same_password" ? "رمز جدید باید با رمز فعلی متفاوت باشد." : error.code === "reauthentication_needed" ? "برای تغییر رمز دوباره وارد شوید." : "تغییر رمز انجام نشد." });
    else setMessage({ ok: true, text: "رمز عبور تغییر کرد." });
  }

  return (
    <Modal open onClose={onClose} title="تغییر رمز عبور" footer={<><Button disabled={pending} onClick={submit}>ذخیره رمز جدید</Button><Button variant="secondary" onClick={onClose}>بستن</Button></>}>
      {message && <Alert tone={message.ok ? "green" : "red"} title={message.text} />}
      <TextField label="رمز عبور جدید" type="password" dir="ltr" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <TextField label="تکرار رمز عبور" type="password" dir="ltr" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
    </Modal>
  );
}

function AuditModal({ timezone, onClose }: { timezone: string; onClose: () => void }) {
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [next, setNext] = useState<number | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (before?: number) => {
    setLoading(true);
    const res = await api<{ items: AuditEntry[]; next_before: number | null }>(`/audit-logs?limit=25${before ? `&before=${before}` : ""}`).catch(() => null);
    setLoading(false);
    if (!res) return;
    setItems((cur) => [...cur, ...res.items]);
    setNext(res.next_before);
  }, []);

  useEffect(() => {
    api<{ items: AuditEntry[]; next_before: number | null }>("/audit-logs?limit=25")
      .then((res) => {
        setItems(res.items);
        setNext(res.next_before);
      })
      .catch(() => setNext(null));
  }, []);

  return (
    <Modal open onClose={onClose} title="گزارش فعالیت‌ها" width={640}>
      <div className="flex flex-col gap-3 text-xs">
        {items.map((e) => (
          <div key={e.id} className="flex items-center justify-between gap-3 border-b border-line pb-3">
            <span>{auditSentence(e)}</span>
            <span className="shrink-0 text-[10px] text-muted">{formatStamp(e.created_at, timezone)}</span>
          </div>
        ))}
        {loading && <p className="text-muted">در حال بارگذاری...</p>}
        {next && !loading && (
          <Button variant="ghost" className="self-start" onClick={() => load(next)}>
            موارد بیشتر
          </Button>
        )}
      </div>
    </Modal>
  );
}
