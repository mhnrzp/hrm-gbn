import { parseQuery, route } from "@/lib/api";
import { listInvoices } from "@/lib/services/invoices";
import { invoiceListSchema } from "@/lib/validation/invoices";
import { csvResponse, toCsv } from "@/lib/csv";
import { faDigits, formatDate, formatToman } from "@/lib/format";
import { INVOICE_STATE } from "@/lib/labels";

const MAX_ROWS = 2000;

// «دریافت گزارش»: current filters as CSV (manager only).
export const GET = route("manager", async ({ req, db, member }) => {
  const q = parseQuery(req, invoiceListSchema);
  const rows = [];
  for (let page = 1; rows.length < MAX_ROWS; page++) {
    const { rows: batch, total } = await listInvoices(db, { ...q, page, limit: 100 });
    rows.push(...batch);
    if (rows.length >= total || batch.length === 0) break;
  }
  const body = toCsv(
    ["شماره", "عنوان", "دریافت‌کننده", "مبلغ (تومان)", "تاریخ سررسید", "نوع پرداخت", "وضعیت", "تاریخ پرداخت"],
    rows.map((r) => [
      faDigits(r.invoice_reference),
      r.title,
      r.supplier_name,
      formatToman(r.amount_irr, false),
      formatDate(r.due_date, "UTC"),
      r.series_id ? "دوره‌ای" : "یک‌باره",
      INVOICE_STATE[r.display_state].label,
      r.paid_at ? formatDate(r.paid_at, member.org.timezone) : "",
    ]),
  );
  return csvResponse("invoices.csv", body);
});
