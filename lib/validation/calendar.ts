import { z } from "zod";
import { hhmm, isoDate, isoInstant, requiredText, text } from "./common";

export const calendarQuerySchema = z
  .object({
    from: isoInstant,
    to: isoInstant,
    employee_ids: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(",").filter(Boolean) : undefined))
      .pipe(z.array(z.uuid()).max(100).optional()),
  })
  .refine((v) => new Date(v.to) > new Date(v.from), { path: ["to"], message: "بازه نامعتبر" });

export const leaveSubmitSchema = z
  .object({
    employee_id: z.uuid().optional(),
    leave_type_id: z.uuid(),
    start_date: isoDate,
    end_date: isoDate,
    all_day: z.boolean().default(true),
    start_time: hhmm.optional(),
    end_time: hhmm.optional(),
    reason: requiredText(1000),
    approve_now: z.boolean().default(false),
  })
  .refine((v) => v.end_date >= v.start_date, { path: ["end_date"], message: "تاریخ پایان باید بعد از تاریخ شروع باشد" })
  .refine((v) => v.all_day || (v.start_time && v.end_time), { path: ["end_time"], message: "ساعت شروع و پایان را وارد کنید" });

export const leavePatchSchema = z
  .object({
    status: z.literal("cancelled"),
    start_date: isoDate,
    end_date: isoDate,
    leave_type_id: z.uuid(),
    reason: requiredText(1000),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "هیچ تغییری ارسال نشده است");

export const leaveReviewSchema = z
  .object({ decision: z.enum(["approve", "reject"]), comment: text(1000).optional() })
  .refine((v) => v.decision === "approve" || (v.comment && v.comment.length > 0), { path: ["comment"], message: "دلیل رد درخواست الزامی است" });

export const leaveListSchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "cancelled"]).optional(),
  employee_id: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const availabilitySchema = z.object({
  employee_id: z.uuid().optional(),
  start_date: isoDate,
  start_time: hhmm,
  end_time: hhmm,
  recurrence_type: z.enum(["none", "weekly"]).default("none"),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).nullable().optional(),
  end_date: isoDate.nullable().optional(),
  note: text(500).default(""),
});
export const availabilityPatchSchema = availabilitySchema.omit({ employee_id: true }).partial();

export const availabilityCheckSchema = z.object({ user_id: z.uuid(), start: isoInstant, end: isoInstant });

export const eventSchema = z
  .object({
    title: requiredText(200),
    description: text(2000).default(""),
    location: text(200).default(""),
    start_at: isoInstant,
    end_at: isoInstant,
    attendee_ids: z.array(z.uuid()).min(1, "حداقل یک شرکت‌کننده انتخاب کنید").max(50),
    force: z.boolean().default(false),
  })
  .refine((v) => new Date(v.end_at) > new Date(v.start_at), { path: ["end_at"], message: "پایان باید بعد از شروع باشد" });
export const eventPatchSchema = z
  .object({
    title: requiredText(200),
    description: text(2000),
    location: text(200),
    start_at: isoInstant,
    end_at: isoInstant,
    attendee_ids: z.array(z.uuid()).min(1).max(50),
    force: z.boolean(),
  })
  .partial();
