import { parseBody, route } from "@/lib/api";
import { createInvoice } from "@/lib/services/invoices";
import { createInvoiceSchema } from "@/lib/validation/invoices";

// Recurring bill template (same body as POST /invoices with payment_type forced to "recurring").
export const POST = route("manager", async ({ req, db }) => {
  const input = await parseBody(req, createInvoiceSchema);
  return createInvoice(db, { ...input, payment_type: "recurring" });
});
