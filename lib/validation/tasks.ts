import { z } from "zod";
import { hhmm, isoDate, isoInstant, requiredText, text } from "./common";

export const PRIORITIES = ["normal", "important", "urgent"] as const;
export const RECURRENCE = ["none", "daily", "weekly", "monthly", "interval_days"] as const;

const schedule = {
  due_date: isoDate,
  due_time: hhmm.default("17:00"),
  start_date: isoDate.nullable().optional(),
  start_time: hhmm.nullable().optional(),
  recurrence_type: z.enum(RECURRENCE).default("none"),
  recurrence_interval: z.number().int().min(1).max(365).default(1),
  recurrence_days_of_week: z.array(z.number().int().min(0).max(6)).max(7).nullable().optional(),
  recurrence_end_date: isoDate.nullable().optional(),
};

export const createTaskSchema = z
  .object({
    title: requiredText(200),
    description: text(4000).default(""),
    priority: z.enum(PRIORITIES).default("normal"),
    assignment_mode: z.enum(["named", "team_pool"]).default("named"),
    completion_policy: z.enum(["any_one", "all_assignees"]).default("any_one"),
    assignee_ids: z.array(z.uuid()).max(20).default([]),
    ...schedule,
  })
  .refine((v) => v.assignment_mode === "team_pool" || v.assignee_ids.length > 0, { path: ["assignee_ids"], message: "مسئول تسک را انتخاب کنید" })
  .refine((v) => !v.start_date || v.start_date <= v.due_date, { path: ["start_date"], message: "تاریخ شروع باید قبل از سررسید باشد" })
  .refine((v) => !v.recurrence_end_date || v.recurrence_end_date >= v.due_date, { path: ["recurrence_end_date"], message: "پایان تکرار باید بعد از سررسید باشد" });
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    title: requiredText(200),
    description: text(4000),
    priority: z.enum(PRIORITIES),
    completion_policy: z.enum(["any_one", "all_assignees"]),
    assignee_ids: z.array(z.uuid()).min(1).max(20),
    due_date: isoDate,
    due_time: hhmm,
    start_date: isoDate.nullable(),
    start_time: hhmm.nullable(),
    recurrence_type: z.enum(RECURRENCE),
    recurrence_interval: z.number().int().min(1).max(365),
    recurrence_days_of_week: z.array(z.number().int().min(0).max(6)).max(7).nullable(),
    recurrence_end_date: isoDate.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "هیچ تغییری ارسال نشده است");

export const boardQuerySchema = z.object({
  status: z.enum(["todo", "in_progress", "completed", "overdue"]).optional(),
  assignee: z.uuid().optional(),
  priority: z.enum(PRIORITIES).optional(),
  due: z.enum(["today", "week", "month", "overdue"]).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});
export type BoardQuery = z.infer<typeof boardQuerySchema>;

// Employee-side update (own assignment) or manager-side management, decided by role in the route.
export const occurrencePatchSchema = z
  .object({
    progress_percent: z.number().int().min(0).max(100),
    status: z.enum(["todo", "in_progress", "completed", "cancelled"]),
    note: text(2000),
    due_at: isoInstant,
    scheduled_start_at: isoInstant.nullable(),
    assignee_ids: z.array(z.uuid()).min(1).max(20),
  })
  .partial();

export const commentSchema = z.object({ body: requiredText(2000) });
export const completeSchema = z.object({ note: text(2000).optional() });
