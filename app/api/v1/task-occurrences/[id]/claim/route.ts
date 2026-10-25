import { route } from "@/lib/api";
import { occurrenceActions } from "@/lib/services/tasks";
import { uuid } from "@/lib/validation/common";

export const POST = route<{ id: string }>("member", async ({ db, params }) => ({ occurrence_id: await occurrenceActions.claim(db, uuid.parse(params.id)) }));
