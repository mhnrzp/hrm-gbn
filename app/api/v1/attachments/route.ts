import { z } from "zod";
import { parseQuery, route } from "@/lib/api";
import { listAttachments } from "@/lib/services/attachments";

const ENTITY = z.enum(["invoice", "task_occurrence", "leave_request"]);

export const GET = route("member", async ({ req, db }) => {
  const q = parseQuery(req, z.object({ entity_type: ENTITY, entity_id: z.uuid() }));
  return { items: await listAttachments(db, q.entity_type, q.entity_id) };
});
