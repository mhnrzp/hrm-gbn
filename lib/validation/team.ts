import { z } from "zod";
import { isoDate, phone, requiredText, text } from "./common";

export const inviteMemberSchema = z.object({
  full_name: requiredText(120),
  email: z.string().trim().toLowerCase().pipe(z.email("ایمیل نامعتبر")),
  phone: phone.optional().default(""),
  job_title: requiredText(120),
  role: z.enum(["manager", "employee"]).default("employee"),
  joined_at: isoDate.optional(),
  send_email: z.boolean().default(true),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const updateMemberSchema = z
  .object({
    role: z.enum(["manager", "employee"]),
    status: z.enum(["active", "inactive"]),
    job_title: text(120),
    work_mode: z.enum(["office", "remote"]),
    manager_id: z.uuid().nullable(),
    annual_leave_quota_days: z.number().min(0).max(366).nullable(),
    joined_at: isoDate.nullable(),
    full_name: requiredText(120),
    phone,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "هیچ تغییری ارسال نشده است");
