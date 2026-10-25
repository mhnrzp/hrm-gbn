import { parseBody, parseQuery, route } from "@/lib/api";
import { createInvoice, invoiceSummary, listInvoices } from "@/lib/services/invoices";
import { createInvoiceSchema, invoiceListSchema } from "@/lib/validation/invoices";

export const GET = route("manager", async ({ req, db }) => {
  const q = parseQuery(req, invoiceListSchema);
  const [{ rows, total }, summary] = await Promise.all([listInvoices(db, q), invoiceSummary(db, q.from, q.to)]);
  return { items: rows, total, page: q.page, limit: q.limit, summary };
});

// payment_type "recurring" creates an invoice series (and its first invoices); otherwise a one-off invoice.
export const POST = route("manager", async ({ req, db }) => createInvoice(db, await parseBody(req, createInvoiceSchema)));
