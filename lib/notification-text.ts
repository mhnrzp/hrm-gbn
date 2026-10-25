// Persian rendering of notification rows (title_key + message_data). Single place for wording.
import { faNumber, formatDayMonth, formatToman } from "./format";

export type NotificationRow = {
  id: string;
  type: string;
  entity_type: string;
  entity_id: string | null;
  title_key: string;
  message_data: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
};

export type NotificationKind = "task" | "leave" | "invoice" | "done" | "team" | "calendar" | "system";

export function renderNotification(n: NotificationRow, tz: string): { title: string; body: string; kind: NotificationKind; href: string } {
  const d = n.message_data as Record<string, string | number | undefined>;
  const s = (k: string) => String(d[k] ?? "");
  const range = d.start_at && d.end_at ? `${formatDayMonth(s("start_at"), tz)} تا ${formatDayMonth(new Date(new Date(s("end_at")).getTime() - 1000).toISOString(), tz)}` : "";
  switch (n.title_key) {
    case "task.assigned":
      return { title: "تخصیص تسک جدید", body: `${s("task_title")} به شما اختصاص یافت.`, kind: "task", href: "/tasks" };
    case "task.pool_available":
      return { title: "تسک جدید در صف تیم", body: `${s("task_title")} برای برداشتن در دسترس است.`, kind: "task", href: "/tasks" };
    case "task.completed":
      return { title: "تسک تکمیل شد", body: `${s("task_title")} توسط ${s("completed_by_name")} تکمیل شد.`, kind: "done", href: "/tasks?status=completed" };
    case "task.commented":
      return { title: "نظر جدید در تسک", body: `${s("author_name")} درباره «${s("task_title")}» نظر داد.`, kind: "task", href: "/tasks" };
    case "task.due_soon":
      return { title: "یادآوری موعد تسک", body: `موعد «${s("task_title")}» نزدیک است.`, kind: "task", href: "/tasks?due=today" };
    case "task.overdue":
      return { title: "تسک عقب‌افتاده", body: `موعد «${s("task_title")}» گذشته است.`, kind: "task", href: "/tasks?status=overdue" };
    case "leave.requested":
      return {
        title: "درخواست مرخصی",
        body: `${s("employee_name")} برای ${range} درخواست مرخصی دارد.${Number(d.conflicting_task_count) > 0 ? ` (${faNumber(Number(d.conflicting_task_count))} تسک در این بازه)` : ""}`,
        kind: "leave",
        href: "/calendar",
      };
    case "leave.approved":
      return { title: "مرخصی تأیید شد", body: `مرخصی ${range} تأیید شد.`, kind: "leave", href: "/calendar" };
    case "leave.rejected":
      return { title: "مرخصی رد شد", body: `درخواست مرخصی ${range} رد شد. دلیل در تاریخچه مرخصی ثبت است.`, kind: "leave", href: "/calendar" };
    case "leave.task_conflict":
      return { title: "تداخل مرخصی با تسک‌ها", body: `مرخصی ${s("employee_name")} با ${faNumber(Number(d.conflicting_task_count))} تسک تداخل دارد.`, kind: "leave", href: "/calendar" };
    case "invoice.due_soon":
      return { title: "یادآوری پرداخت", body: `${s("title")} به مبلغ ${formatToman(s("amount_irr"))} نزدیک به سررسید است.`, kind: "invoice", href: "/invoices?state=due_soon" };
    case "invoice.overdue":
      return { title: "یادآوری پرداخت", body: `${s("title")} از سررسید گذشته است.`, kind: "invoice", href: "/invoices?state=overdue" };
    case "invoice.paid":
      return { title: "پرداخت ثبت شد", body: `پرداخت ${s("title")} به مبلغ ${formatToman(s("amount_irr"))} ثبت شد.`, kind: "done", href: "/invoices?state=paid" };
    case "event.scheduled":
      return { title: "جلسه جدید", body: `${s("title")} در ${formatDayMonth(s("start_at"), tz)} برنامه‌ریزی شد.`, kind: "calendar", href: "/calendar" };
    case "event.cancelled":
      return { title: "جلسه لغو شد", body: `${s("title")} لغو شد.`, kind: "calendar", href: "/calendar" };
    case "team.member_invited":
      return { title: "عضو جدید دعوت شد", body: `${s("member_name")} به مجموعه دعوت شد.`, kind: "team", href: "/team" };
    case "team.member_deactivated":
      return { title: "عضو غیرفعال شد", body: `حساب ${s("member_name")} غیرفعال شد.`, kind: "team", href: "/team" };
    case "digest.weekly":
      return {
        title: "خلاصه هفتگی تیم",
        body: `${faNumber(Number(d.open_tasks ?? 0))} تسک این هفته، ${faNumber(Number(d.overdue_tasks ?? 0))} عقب‌افتاده، ${faNumber(Number(d.pending_leave ?? 0))} مرخصی در انتظار و ${faNumber(Number(d.invoices_due ?? 0))} صورت‌حساب پیش رو.`,
        kind: "system",
        href: "/",
      };
    case "system.job_failed":
      return { title: "خطا در پردازش خودکار", body: "برخی کارهای زمان‌بندی‌شده چند بار ناموفق بوده‌اند.", kind: "system", href: "/settings" };
    default:
      return { title: "اعلان", body: "", kind: "system", href: "/" };
  }
}
