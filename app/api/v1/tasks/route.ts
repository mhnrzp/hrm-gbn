import { z } from "zod";
import { parseBody, parseQuery, route } from "@/lib/api";
import { createTask, listTasks } from "@/lib/services/tasks";
import { createTaskSchema } from "@/lib/validation/tasks";
import { pagination } from "@/lib/validation/common";

const listQuery = z.object({ ...pagination, include_archived: z.enum(["true", "false"]).optional() });

// Series list (RLS limits employees to their own / team-pool series).
export const GET = route("member", async ({ req, db }) => {
  const q = parseQuery(req, listQuery);
  return listTasks(db, { limit: q.limit, cursor: q.cursor, includeArchived: q.include_archived === "true" });
});

export const POST = route("manager", async ({ req, db, member }) => {
  const input = await parseBody(req, createTaskSchema);
  return createTask(db, member, input);
});
