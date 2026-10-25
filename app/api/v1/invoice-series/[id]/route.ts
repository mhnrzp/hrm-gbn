import { parseBody, route } from "@/lib/api";
import { updateSeries } from "@/lib/services/invoices";
import { updateSeriesSchema } from "@/lib/validation/invoices";
import { uuid } from "@/lib/validation/common";

// Affects future unpaid invoices only; paid history is preserved.
export const PATCH = route<{ id: string }>("manager", async ({ req, db, params }) => updateSeries(db, uuid.parse(params.id), await parseBody(req, updateSeriesSchema)));
