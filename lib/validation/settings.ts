import { z } from "zod";
import { phone, requiredText, text } from "./common";

const TIMEZONES = typeof Intl.supportedValuesOf === "function" ? new Set(Intl.supportedValuesOf("timeZone")) : null;

export const profilePatchSchema = z
  .object({ full_name: requiredText(120), phone, avatar_path: z.string().max(300).nullable() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "هیچ تغییری ارسال نشده است");

export const preferencesPatchSchema = z
  .object({
    in_app_enabled: z.boolean(),
    email_enabled: z.boolean(),
    notify_leave_requests: z.boolean(),
    notify_task_status: z.boolean(),
    task_reminder_enabled: z.boolean(),
    task_reminder_days: z.number().int().min(0).max(30),
    invoice_reminder_enabled: z.boolean(),
    invoice_reminder_days: z.number().int().min(0).max(60),
    weekly_digest_enabled: z.boolean(),
    compact_tables: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "هیچ تغییری ارسال نشده است");

export const companyPatchSchema = z
  .object({
    name: requiredText(200),
    registration_code: text(40).nullable(),
    email: z.union([z.literal(""), z.email("ایمیل نامعتبر")]).nullable(),
    phone: phone.nullable(),
    address: text(500).nullable(),
    timezone: z.string().refine((tz) => !TIMEZONES || TIMEZONES.has(tz) || tz === "UTC", "منطقه زمانی نامعتبر"),
    week_start: z.number().int().min(0).max(6),
    weekend_days: z.array(z.number().int().min(0).max(6)).max(3),
    default_leave_quota_days: z.number().min(0).max(366),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "هیچ تغییری ارسال نشده است");
