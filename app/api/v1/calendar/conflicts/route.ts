import { z } from "zod";
import { parseQuery, route } from "@/lib/api";
import { scheduleConflicts } from "@/lib/services/calendar";
import { isoInstant } from "@/lib/validation/common";

export const GET = route("manager", async ({ req, db }) => {
  const q = parseQuery(req, z.object({ from: isoInstant, to: isoInstant }));
  return { items: await scheduleConflicts(db, q.from, q.to) };
});
