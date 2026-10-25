import { z } from "zod";
import { parseQuery, route } from "@/lib/api";
import { listAuditLogs } from "@/lib/services/settings";

export const GET = route("manager", async ({ req, db }) => {
  const q = parseQuery(req, z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), before: z.coerce.number().int().positive().optional() }));
  return listAuditLogs(db, q);
});
