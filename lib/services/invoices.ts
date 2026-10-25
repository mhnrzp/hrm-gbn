import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "@/lib/errors";
import { irrToTomanString, tomanToIrr } from "@/lib/money";
import type { CreateInvoiceInput, InvoiceListQuery } from "@/lib/validation/invoices";

export type InvoiceRow = {
  id: string;
  series_id: string | null;
  title: string;
  supplier_name: string;
  invoice_reference: string;
  amount_irr: string;
  amount_toman: string;
  due_date: string;
  payment_state: "unpaid" | "paid" | "cancelled";
  display_state: "unpaid" | "paid" | "cancelled" | "overdue" | "due_soon";
  recurrence_type: string | null;
  paid_at: string | null;
};

export type InvoiceSummary = {
  unpaid_irr: string;
  unpaid_count: number;
  paid_irr: string;
  paid_count: number;
  due_soon_irr: string;
  due_soon_count: number;
  overdue_irr: string;
  overdue_count: number;
  lead_days: number;
};

const withToman = <T extends { amount_irr: string }>(r: T) => ({ ...r, amount_toman: irrToTomanString(r.amount_irr) });

export async function listInvoices(db: SupabaseClient, q: Partial<InvoiceListQuery>) {
  const limit = q.limit ?? 10;
  const rows = unwrap(
    await db.rpc("invoice_list", {
      p_state: q.state ?? null,
      p_from: q.from ?? null,
      p_to: q.to ?? null,
      p_q: q.q || null,
      p_limit: limit,
      p_offset: ((q.page ?? 1) - 1) * limit,
    }),
  ) as (Omit<InvoiceRow, "amount_toman"> & { total_count: number })[];
  return { rows: rows.map(({ total_count: _, ...r }) => withToman(r)) as InvoiceRow[], total: Number(rows[0]?.total_count ?? 0) };
}

export async function invoiceSummary(db: SupabaseClient, from?: string, to?: string) {
  return unwrap(await db.rpc("invoice_summary", { p_from: from ?? null, p_to: to ?? null })) as InvoiceSummary;
}

export type InvoiceDetail = Omit<InvoiceRow, "amount_toman" | "recurrence_type"> & {
  amount_toman: string;
  description: string;
  issue_date: string | null;
  days_overdue: number;
  reminder_enabled: boolean;
  created_at: string;
  created_by_name: string;
  series: { recurrence_type: string; recurrence_interval: number; first_due_date: string; end_date: string | null; is_active: boolean } | null;
  payments: { id: string; amount_irr: string; paid_at: string; method: string; transaction_reference: string | null; notes: string | null; confirmed_by_name: string; created_at: string; voided_at: string | null; void_reason: string | null }[];
  organization: { name: string; address: string | null; phone: string | null; registration_code: string | null };
};

export async function invoiceDetail(db: SupabaseClient, id: string) {
  const d = unwrap(await db.rpc("invoice_detail", { p_id: id })) as Omit<InvoiceDetail, "amount_toman">;
  return withToman(d) as InvoiceDetail;
}

export async function createInvoice(db: SupabaseClient, input: CreateInvoiceInput) {
  const base = {
    title: input.title,
    supplier_name: input.supplier_name,
    description: input.description,
    amount_irr: tomanToIrr(input.amount_toman).toString(),
    reminder_enabled: input.reminder_enabled,
  };
  if (input.payment_type === "recurring") {
    return unwrap(
      await db.rpc("create_invoice_series", { p: { ...base, recurrence_type: input.recurrence_type, first_due_date: input.due_date, end_date: input.end_date ?? null } }),
    ) as { series_id: string; invoice_id: string; generated: number };
  }
  return unwrap(await db.rpc("create_invoice", { p: { ...base, due_date: input.due_date, issue_date: input.issue_date ?? null } })) as { invoice_id: string; invoice_reference: string };
}

function toIrrPatch<T extends { amount_toman?: string }>(patch: T) {
  const { amount_toman, ...rest } = patch;
  return amount_toman !== undefined ? { ...rest, amount_irr: tomanToIrr(amount_toman).toString() } : rest;
}

export async function updateInvoice(db: SupabaseClient, id: string, patch: Record<string, unknown> & { amount_toman?: string }) {
  return unwrap(await db.rpc("update_invoice", { p_id: id, p: toIrrPatch(patch) }));
}

export async function updateSeries(db: SupabaseClient, id: string, patch: Record<string, unknown> & { amount_toman?: string }) {
  return unwrap(await db.rpc("update_invoice_series", { p_id: id, p: toIrrPatch(patch) }));
}

export async function markPaid(
  db: SupabaseClient,
  id: string,
  input: { amount_toman: string; paid_at: string; method: string; transaction_reference?: string; notes?: string; idempotency_key: string },
) {
  const { amount_toman, ...rest } = input;
  return unwrap(await db.rpc("mark_invoice_paid", { p_id: id, p: { ...rest, amount_irr: tomanToIrr(amount_toman).toString() } }));
}

export async function voidPayment(db: SupabaseClient, id: string, reason: string) {
  return unwrap(await db.rpc("void_payment", { p_id: id, p_reason: reason }));
}

export async function invoiceSuppliers(db: SupabaseClient) {
  return unwrap(await db.rpc("invoice_suppliers")) as string[];
}
