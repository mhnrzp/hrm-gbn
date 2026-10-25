import { route } from "@/lib/api";
import { downloadUrl } from "@/lib/services/attachments";
import { uuid } from "@/lib/validation/common";

export const GET = route<{ id: string }>("member", async ({ db, params }) => downloadUrl(db, uuid.parse(params.id)));
