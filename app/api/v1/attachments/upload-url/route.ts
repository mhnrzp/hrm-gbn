import { z } from "zod";
import { parseBody, route } from "@/lib/api";
import { prepareUpload } from "@/lib/services/attachments";

const schema = z.object({
  entity_type: z.enum(["invoice", "task_occurrence", "leave_request"]),
  entity_id: z.uuid(),
  file_name: z.string().trim().min(1).max(200),
  mime_type: z.string().max(120),
  size_bytes: z.number().int().min(1).max(10 * 1024 * 1024),
});

export const POST = route("member", async ({ req, db }) => prepareUpload(db, await parseBody(req, schema)));
