import { parseBody, route } from "@/lib/api";
import { occurrenceActions } from "@/lib/services/tasks";
import { commentSchema } from "@/lib/validation/tasks";
import { uuid } from "@/lib/validation/common";

export const POST = route<{ id: string }>("member", async ({ req, db, params }) => {
  const { body } = await parseBody(req, commentSchema);
  return occurrenceActions.comment(db, uuid.parse(params.id), body);
});
