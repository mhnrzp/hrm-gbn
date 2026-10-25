import { route } from "@/lib/api";
import { archiveTask } from "@/lib/services/tasks";
import { uuid } from "@/lib/validation/common";

export const POST = route<{ id: string }>("manager", async ({ db, params }) => archiveTask(db, uuid.parse(params.id)));
