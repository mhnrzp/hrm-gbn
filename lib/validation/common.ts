import { z } from "zod";
import { toLatinDigits } from "@/lib/format";

export const uuid = z.uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ نامعتبر").refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "تاریخ نامعتبر");
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "ساعت نامعتبر");
export const isoInstant = z.iso.datetime({ offset: true });

/** Trimmed text with Persian/Arabic digits normalised to ASCII where it matters (phones, codes). */
export const text = (max: number) => z.string().trim().max(max);
export const requiredText = (max: number) => z.string().trim().min(1, "این فیلد الزامی است").max(max);
export const phone = z
  .string()
  .trim()
  .transform((v) => toLatinDigits(v).replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^\+?\d{0,15}$/, "شماره تلفن نامعتبر"));

/** Whole toman as integer string (BigInt-safe). */
export const amountToman = z
  .union([z.string(), z.number().int()])
  .transform((v) => toLatinDigits(String(v)).replace(/[\s,٬]/g, ""))
  .pipe(z.string().regex(/^\d{1,15}$/, "مبلغ نامعتبر"));

export const pagination = {
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
};
