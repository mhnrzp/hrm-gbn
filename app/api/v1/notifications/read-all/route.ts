import { route } from "@/lib/api";
import { markAllRead } from "@/lib/services/notifications";

export const POST = route("member", async ({ db, member }) => markAllRead(db, member.userId));
