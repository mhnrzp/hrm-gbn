import { parseBody, route } from "@/lib/api";
import { getTask, updateTaskSeries } from "@/lib/services/tasks";
import { updateTaskSchema } from "@/lib/validation/tasks";
import { uuid } from "@/lib/validation/common";

export const GET = route<{ id: string }>("member", async ({ db, params }) => getTask(db, uuid.parse(params.id)));

export const PATCH = route<{ id: string }>("manager", async ({ req, db, params }) => {
  const patch = await parseBody(req, updateTaskSchema);
  return updateTaskSeries(db, uuid.parse(params.id), patch);
});
