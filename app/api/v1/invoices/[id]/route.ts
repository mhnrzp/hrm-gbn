import { parseBody, route } from "@/lib/api";
import { invoiceDetail, updateInvoice } from "@/lib/services/invoices";
import { updateInvoiceSchema } from "@/lib/validation/invoices";
import { uuid } from "@/lib/validation/common";

export const GET = route<{ id: string }>("manager", async ({ db, params }) => invoiceDetail(db, uuid.parse(params.id)));

export const PATCH = route<{ id: string }>("manager", async ({ req, db, params }) => updateInvoice(db, uuid.parse(params.id), await parseBody(req, updateInvoiceSchema)));
