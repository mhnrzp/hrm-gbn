// Persian labels + Figma badge tones for enum values (single source for every screen).
import type { Tone } from "@/components/ui/primitives";

export const PRIORITY: Record<string, { label: string; tone: Tone }> = {
  normal: { label: "عادی", tone: "blue" },
  important: { label: "مهم", tone: "amber" },
  urgent: { label: "فوری", tone: "red" },
};

export const TASK_STATUS: Record<string, { label: string; tone: Tone }> = {
  todo: { label: "انجام‌نشده", tone: "gray" },
  in_progress: { label: "در حال انجام", tone: "blue" },
  completed: { label: "تکمیل‌شده", tone: "green" },
  cancelled: { label: "لغوشده", tone: "gray" },
  overdue: { label: "عقب‌افتاده", tone: "red" },
};

export const RECURRENCE_LABEL: Record<string, string> = {
  none: "بدون تکرار",
  daily: "هر روز",
  weekly: "هر هفته",
  monthly: "هر ماه",
  interval_days: "هر چند روز",
};

export const DUE_FILTER: Record<string, string> = {
  today: "امروز",
  week: "هفت روز آینده",
  month: "سی روز آینده",
  overdue: "عقب‌افتاده",
};

export const ROLE_LABEL: Record<string, string> = { manager: "مدیر", employee: "کارمند" };

export const INVOICE_STATE: Record<string, { label: string; tone: Tone }> = {
  unpaid: { label: "پرداخت‌نشده", tone: "amber" },
  due_soon: { label: "پرداخت‌نشده", tone: "amber" },
  overdue: { label: "سررسید گذشته", tone: "red" },
  paid: { label: "پرداخت‌شده", tone: "green" },
  cancelled: { label: "لغوشده", tone: "gray" },
};

export const PAYMENT_METHOD: Record<string, string> = {
  bank_transfer: "انتقال بانکی",
  card: "کارت به کارت",
  cash: "نقدی",
  cheque: "چک",
  other: "سایر",
};
