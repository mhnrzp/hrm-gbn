import { parseBody, route } from "@/lib/api";
import { voidPayment } from "@/lib/services/invoices";
import { voidPaymentSchema } from "@/lib/validation/invoices";
import { uuid } from "@/lib/validation/common";

export const POST = route<{ id: string }>("manager", async ({ req, db, params }) => {
  const { reason } = await parseBody(req, voidPaymentSchema);
  return voidPayment(db, uuid.parse(params.id), reason);
});
