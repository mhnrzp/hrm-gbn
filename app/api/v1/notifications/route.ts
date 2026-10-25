import { z } from "zod";
import { parseQuery, route } from "@/lib/api";
import { listNotifications } from "@/lib/services/notifications";
import { pagination } from "@/lib/validation/common";

export const GET = route("member", async ({ req, db, member }) => {
  const q = parseQuery(req, z.object({ ...pagination, unread: z.enum(["true", "false"]).optional() }));
  return listNotifications(db, member.userId, { limit: q.limit, cursor: q.cursor, unreadOnly: q.unread === "true" });
});
