"use client";
// Figma 1:1179 «افزودن کارمند»; edit uses the same field set.
import { useId, useRef, useState, type FormEvent } from "react";
import { TriangleAlert, Upload, UserPlus } from "lucide-react";
import { Alert, Avatar, Button } from "@/components/ui/primitives";
import { DateField, Modal, SelectField, TextField, Toggle } from "@/components/ui/controls";
import { api, ApiError, fieldError } from "@/lib/client-api";
import { createClient } from "@/lib/supabase/browser";
import type { DirectoryRow } from "@/lib/services/team";
import type { TeamMe } from "./team-view";

const JOB_TITLES = ["مدیر مجموعه", "طراح محصول", "توسعه‌دهنده", "کارشناس پشتیبانی", "کارشناس محتوا", "کارشناس مالی", "کارشناس منابع انسانی"];
const MAX_AVATAR = 2 * 1024 * 1024;

/** Upload to avatars/<org>/<user>/<uuid>.<ext> with the user's own session (storage RLS checks the path). */
export async function uploadAvatar(orgId: string, userId: string, file: File): Promise<string> {
  if (file.size > MAX_AVATAR) throw new ApiError("FILE_TOO_LARGE", "حجم تصویر باید کمتر از ۲ مگابایت باشد.");
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new ApiError("FILE_TYPE_NOT_ALLOWED", "فقط تصویر PNG، JPEG یا WebP مجاز است.");
  const ext = file.type.split("/")[1];
  const path = `${orgId}/${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await createClient().storage.from("avatars").upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new ApiError("INTERNAL", "بارگذاری تصویر انجام نشد.");
  return path;
}

function AvatarPicker({ name, file, onFile }: { name: string; file: File | null; onFile: (f: File | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const preview = file ? URL.createObjectURL(file) : null;
  return (
    <div className="flex items-center gap-3">
      <Avatar name={name || "؟"} seed={name} src={preview} size={52} />
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      <Button variant="secondary" icon={Upload} onClick={() => input.current?.click()}>
        بارگذاری تصویر
      </Button>
    </div>
  );
}

export function InviteMemberModal({ me, onClose, onSaved }: { me: TeamMe; onClose: () => void; onSaved: (message: string) => void }) {
  const titlesId = useId();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [role, setRole] = useState<"employee" | "manager">("employee");
  const [joinedAt, setJoinedAt] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [avatar, setAvatar] = useState<File | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await api<{ user_id: string; email_sent: boolean }>("/team-members/invitations", {
        body: { full_name: fullName, email, phone, job_title: jobTitle, role, joined_at: joinedAt || undefined, send_email: sendEmail },
      });
      if (avatar) {
        const path = await uploadAvatar(me.orgId, res.user_id, avatar);
        await api(`/team-members/${res.user_id}`, { method: "PATCH", body: { avatar_path: path } });
      }
      onSaved(res.email_sent ? `دعوت‌نامه برای ${email} ارسال شد.` : `${fullName} اضافه شد؛ ایمیل دعوت ارسال نشد.`);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="افزودن کارمند"
      subtitle="عضو جدید را به مجموعه دعوت کنید."
      footer={
        <>
          <Button type="submit" form="invite-form" icon={UserPlus} disabled={pending}>
            افزودن و ارسال دعوت
          </Button>
          <Button variant="secondary" onClick={onClose}>
            انصراف
          </Button>
        </>
      }
    >
      <form id="invite-form" onSubmit={submit} className="flex flex-col gap-3">
        {error ? <Alert title={error instanceof ApiError ? error.messageFa : "دعوت انجام نشد."} /> : null}
        <AvatarPicker name={fullName} file={avatar} onFile={setAvatar} />
        <TextField label="نام و نام خانوادگی" required placeholder="نام و نام خانوادگی را وارد کنید" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} error={fieldError(error, "full_name")} />
        <TextField label="ایمیل" required type="email" dir="ltr" placeholder="name@gbn.ir" value={email} onChange={(e) => setEmail(e.target.value)} error={fieldError(error, "email")} />
        <TextField label="شماره موبایل" dir="ltr" inputMode="tel" placeholder="۰۹۱۲ ۰۰۰ ۰۰۰۰" value={phone} onChange={(e) => setPhone(e.target.value)} error={fieldError(error, "phone")} />
        <TextField label="سمت" required list={titlesId} placeholder="سمت را انتخاب کنید" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={120} error={fieldError(error, "job_title")} />
        <datalist id={titlesId}>
          {JOB_TITLES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <SelectField label="سطح دسترسی" options={[{ value: "employee", label: "کارمند" }, { value: "manager", label: "مدیر" }]} value={role} onChange={(e) => setRole(e.target.value as "employee" | "manager")} />
        <DateField label="تاریخ شروع همکاری" value={joinedAt} onChange={setJoinedAt} placeholder="انتخاب تاریخ" />
        <Toggle label="ارسال ایمیل دعوت" description="لینک ورود برای کارمند ارسال شود." checked={sendEmail} onChange={setSendEmail} />
        <Alert tone="blue" icon={TriangleAlert} title={role === "manager" ? "دسترسی: مدیر" : "دسترسی پیش‌فرض: کارمند"}>
          {role === "manager" ? "مدیر به همه بخش‌ها از جمله صورت‌حساب‌ها دسترسی دارد." : "عضو جدید فقط تسک‌ها و برنامه شخصی خود را مدیریت می‌کند."}
        </Alert>
      </form>
    </Modal>
  );
}

export function EditMemberModal({ row, me, members, onClose, onSaved }: { row: DirectoryRow; me: TeamMe; members: DirectoryRow[]; onClose: () => void; onSaved: () => void }) {
  const [fullName, setFullName] = useState(row.full_name);
  const [phone, setPhone] = useState(row.phone ?? "");
  const [jobTitle, setJobTitle] = useState(row.job_title);
  const [role, setRole] = useState(row.role);
  const [workMode, setWorkMode] = useState(row.work_mode);
  const [managerId, setManagerId] = useState(row.manager_id ?? "");
  const [joinedAt, setJoinedAt] = useState(row.joined_at ?? "");
  const [quota, setQuota] = useState("");
  const [avatar, setAvatar] = useState<File | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const patch: Record<string, unknown> = {};
    if (fullName !== row.full_name) patch.full_name = fullName;
    if (phone !== (row.phone ?? "")) patch.phone = phone;
    if (jobTitle !== row.job_title) patch.job_title = jobTitle;
    if (role !== row.role) patch.role = role;
    if (workMode !== row.work_mode) patch.work_mode = workMode;
    if (managerId !== (row.manager_id ?? "")) patch.manager_id = managerId || null;
    if (joinedAt !== (row.joined_at ?? "")) patch.joined_at = joinedAt || null;
    if (quota) patch.annual_leave_quota_days = Number(quota);
    try {
      if (avatar) patch.avatar_path = await uploadAvatar(me.orgId, row.user_id, avatar);
      if (Object.keys(patch).length) await api(`/team-members/${row.user_id}`, { method: "PATCH", body: patch });
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="ویرایش اطلاعات"
      subtitle={row.full_name}
      footer={
        <>
          <Button type="submit" form="member-form" disabled={pending}>
            ذخیره تغییرات
          </Button>
          <Button variant="secondary" onClick={onClose}>
            انصراف
          </Button>
        </>
      }
    >
      <form id="member-form" onSubmit={submit} className="flex flex-col gap-3">
        {error ? <Alert title={error instanceof ApiError ? error.messageFa : "ذخیره انجام نشد."} /> : null}
        <AvatarPicker name={fullName} file={avatar} onFile={setAvatar} />
        <TextField label="نام و نام خانوادگی" required value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} />
        <TextField label="شماره موبایل" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} error={fieldError(error, "phone")} />
        <TextField label="سمت" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={120} />
        <div className="grid grid-cols-2 gap-2.5">
          <SelectField label="سطح دسترسی" options={[{ value: "employee", label: "کارمند" }, { value: "manager", label: "مدیر" }]} value={role} onChange={(e) => setRole(e.target.value as "employee" | "manager")} />
          <SelectField label="نحوه حضور" options={[{ value: "office", label: "حضوری" }, { value: "remote", label: "دورکار" }]} value={workMode} onChange={(e) => setWorkMode(e.target.value as "office" | "remote")} />
        </div>
        <SelectField label="مدیر مستقیم" placeholder="بدون مدیر مستقیم" options={members.filter((m) => m.user_id !== row.user_id).map((m) => ({ value: m.user_id, label: m.full_name }))} value={managerId} onChange={(e) => setManagerId(e.target.value)} />
        <div className="grid grid-cols-2 gap-2.5">
          <DateField label="تاریخ شروع همکاری" value={joinedAt} onChange={setJoinedAt} />
          <TextField label="سهمیه مرخصی سالانه (روز)" inputMode="numeric" placeholder="پیش‌فرض مجموعه" value={quota} onChange={(e) => setQuota(e.target.value.replace(/[^\d.]/g, ""))} />
        </div>
      </form>
    </Modal>
  );
}
