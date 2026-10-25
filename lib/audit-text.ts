// Persian sentence for an audit entry («گزارش فعالیت‌ها»). Values marked [redacted] are never shown.
import type { AuditEntry } from "@/lib/services/settings";

export function auditSentence(e: AuditEntry): string {
  const who = e.actor_name;
  const label = e.entity_label ? `«${e.entity_label}»` : "";
  const f = e.changed_fields ?? {};
  const op = e.action.split(".")[1];
  switch (e.entity_type) {
    case "tasks":
      if (op === "insert") return `${who} تسک ${label} را ایجاد کرد.`;
      if ("archived_at" in f && f.archived_at) return `${who} تسک ${label} را بایگانی کرد.`;
      return `${who} تسک ${label} را به‌روزرسانی کرد.`;
    case "task_occurrences":
      if (f.status === "completed") return `${who} تسک ${label} را تکمیل کرد.`;
      if (f.status === "cancelled") return `${who} تسک ${label} را لغو کرد.`;
      if ("claimed_by" in f) return `${who} تسک ${label} را برداشت.`;
      return `${who} وضعیت تسک ${label} را تغییر داد.`;
    case "task_assignees":
      return `${who} مسئولان تسک را تغییر داد.`;
    case "leave_requests":
      if (op === "insert") return f.status === "approved" ? `${who} مرخصی ${e.entity_label ?? ""} را مستقیم ثبت کرد.` : `درخواست مرخصی ${e.entity_label ?? ""} ثبت شد.`;
      if (f.status === "approved") return `${who} مرخصی ${e.entity_label ?? ""} را تأیید کرد.`;
      if (f.status === "rejected") return `${who} درخواست مرخصی ${e.entity_label ?? ""} را رد کرد.`;
      if (f.status === "cancelled") return `درخواست مرخصی ${e.entity_label ?? ""} لغو شد.`;
      return `درخواست مرخصی ${e.entity_label ?? ""} ویرایش شد.`;
    case "invoices":
      if (op === "insert") return `${who} صورت‌حساب ${label} را ثبت کرد.`;
      if (f.payment_state === "paid") return `پرداخت ${label} توسط ${who} ثبت شد.`;
      if (f.payment_state === "unpaid") return `پرداخت ${label} توسط ${who} اصلاح شد.`;
      if (f.payment_state === "cancelled") return `${who} صورت‌حساب ${label} را لغو کرد.`;
      return `${who} صورت‌حساب ${label} را ویرایش کرد.`;
    case "invoice_series":
      return op === "insert" ? `${who} صورت‌حساب دوره‌ای ${label} را تعریف کرد.` : `${who} صورت‌حساب دوره‌ای ${label} را تغییر داد.`;
    case "payment_records":
      return "void_reason" in f ? `${who} پرداخت ${label} را ابطال کرد.` : `پرداخت ${label} ثبت شد.`;
    case "organization_memberships":
      if (op === "insert") return `${e.entity_label ?? "عضو جدید"} به مجموعه اضافه شد.`;
      if (f.status === "inactive") return `${who} حساب ${e.entity_label ?? ""} را غیرفعال کرد.`;
      if (f.status === "active") return `${e.entity_label ?? ""} عضویت خود را فعال کرد.`;
      if ("role" in f) return `${who} سطح دسترسی ${e.entity_label ?? ""} را تغییر داد.`;
      return `${who} اطلاعات ${e.entity_label ?? ""} را ویرایش کرد.`;
    case "organizations":
      return `تنظیمات مجموعه توسط ${who} تغییر کرد.`;
    case "calendar_events":
      if (f.is_cancelled === true) return `${who} رویداد ${label} را لغو کرد.`;
      return op === "insert" ? `${who} رویداد ${label} را ایجاد کرد.` : `${who} رویداد ${label} را تغییر داد.`;
    case "invitations":
      return op === "insert" ? `${who} یک عضو جدید دعوت کرد.` : "دعوت‌نامه پذیرفته شد.";
    case "attachments":
      return `${who} پیوستی بارگذاری کرد.`;
    default:
      return `${who} تغییری ثبت کرد.`;
  }
}
