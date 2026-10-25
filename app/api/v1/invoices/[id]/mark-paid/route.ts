import { parseBody, route } from "@/lib/api";
import { markPaid } from "@/lib/services/invoices";
import { markPaidSchema } from "@/lib/validation/invoices";
import { uuid } from "@/lib/validation/common";
import { localIsoDate } from "@/lib/format";

// Records a verified full payment (no money moves). Retries with the same idempotency_key are no-ops.
export const POST = route<{ id: string }>("manager", async ({ req, db, member, params }) => {
  const input = await parseBody(req, markPaidSchema);
  const tz = member.org.timezone;
  const paidAt = input.paid_date === localIsoDate(new Date(), tz) ? new Date().toISOString() : `${input.paid_date} 12:00:00 ${tz}`;
  return markPaid(db, uuid.parse(params.id), { ...input, paid_at: paidAt });
});
