import { route } from "@/lib/api";
import { deleteAttachment } from "@/lib/services/attachments";
import { uuid } from "@/lib/validation/common";

export const DELETE = route<{ id: string }>("member", async ({ db, params }) => deleteAttachment(db, uuid.parse(params.id)));
