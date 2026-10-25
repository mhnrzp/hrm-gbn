import { parseOptionalBody, route } from "@/lib/api";
import { occurrenceActions } from "@/lib/services/tasks";
import { completeSchema } from "@/lib/validation/tasks";
import { uuid } from "@/lib/validation/common";

export const POST = route<{ id: string }>("member", async ({ req, db, params }) => {
  const { note } = await parseOptionalBody(req, completeSchema);
  return occurrenceActions.complete(db, uuid.parse(params.id), note);
});
