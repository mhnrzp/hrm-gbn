import { z } from "zod";
import { amountToman, isoDate, requiredText, text } from "./common";

export const PAYMENT_METHODS = ["bank_transfer", "card", "cash", "cheque", "other"] as const;
export const INVOICE_STATES = ["unpaid", "paid", "overdue", "due_soon", "cancelled"] as const;

export const createInvoiceSchema = z
  .object({
    title: requiredText(200),
    supplier_name: requiredText(200),
    amount_toman: amountToman,
    due_date: isoDate,
    issue_date: isoDate.nullable().optional(),
    description: text(2000).default(""),
    reminder_enabled: z.boolean().default(true),
    payment_type: z.enum(["one_off", "recurring"]).default("one_off"),
    recurrence_type: z.enum(["monthly", "weekly"]).default("monthly"),
    end_date: isoDate.nullable().optional(),
  })
  .refine((v) => BigInt(v.amount_toman) > BigInt(0), { path: ["amount_toman"], message: "مبلغ باید بیشتر از صفر باشد." })
  .refine((v) => !v.end_date || v.end_date >= v.due_date, { path: ["end_date"], message: "پایان دوره باید بعد از سررسید باشد" });
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const updateInvoiceSchema = z
  .object({
    title: requiredText(200),
    supplier_name: requiredText(200),
    amount_toman: amountToman,
    due_date: isoDate,
    issue_date: isoDate.nullable(),
    description: text(2000),
    reminder_enabled: z.boolean(),
    payment_state: z.literal("cancelled"),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "هیچ تغییری ارسال نشده است");

export const updateSeriesSchema = z
  .object({
    title: requiredText(200),
    supplier_name: requiredText(200),
    amount_toman: amountToman,
    description: text(2000),
    recurrence_type: z.enum(["monthly", "weekly"]),
    first_due_date: isoDate,
    end_date: isoDate.nullable(),
    reminder_enabled: z.boolean(),
    is_active: z.literal(false),
  })
  .partial();

export const markPaidSchema = z.object({
  amount_toman: amountToman,
  paid_date: isoDate,
  method: z.enum(PAYMENT_METHODS).default("bank_transfer"),
  transaction_reference: text(100).optional(),
  notes: text(1000).optional(),
  idempotency_key: z.string().min(8).max(100),
});

export const voidPaymentSchema = z.object({ reason: requiredText(1000) });

export const invoiceListSchema = z.object({
  state: z.enum(INVOICE_STATES).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});
export type InvoiceListQuery = z.infer<typeof invoiceListSchema>;
