import { route } from "@/lib/api";
import { markRead } from "@/lib/services/notifications";
import { uuid } from "@/lib/validation/common";

export const PATCH = route<{ id: string }>("member", async ({ db, member, params }) => markRead(db, member.userId, uuid.parse(params.id)));
