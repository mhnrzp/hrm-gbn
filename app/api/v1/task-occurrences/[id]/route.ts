import { parseBody, route } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { getOccurrence, occurrenceActions } from "@/lib/services/tasks";
import { occurrencePatchSchema } from "@/lib/validation/tasks";
import { uuid } from "@/lib/validation/common";

export const GET = route<{ id: string }>("member", async ({ db, params }) => getOccurrence(db, uuid.parse(params.id)));

// Managers: status / reschedule / reassign. Employees: own progress, todo↔in_progress, note.
export const PATCH = route<{ id: string }>("member", async ({ req, db, member, params }) => {
  const id = uuid.parse(params.id);
  const patch = await parseBody(req, occurrencePatchSchema);

  if (member.role === "manager" && (patch.due_at || patch.assignee_ids || patch.status === "cancelled" || patch.status === "completed")) {
    return occurrenceActions.manage(db, id, patch);
  }
  if (patch.due_at || patch.assignee_ids || patch.status === "cancelled") throw new AppError("FORBIDDEN");
  if (patch.status === "completed") return occurrenceActions.complete(db, id, patch.note);
  if (member.role === "manager" && patch.status && patch.progress_percent === undefined) {
    // Manager moving a card they are not assigned to.
    return occurrenceActions.manage(db, id, { status: patch.status });
  }
  return occurrenceActions.progress(db, id, { progress_percent: patch.progress_percent, status: patch.status, note: patch.note });
});
