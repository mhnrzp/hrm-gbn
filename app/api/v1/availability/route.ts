import { z } from "zod";
import { parseBody, parseQuery, route } from "@/lib/api";
import { listAvailabilityRules, saveAvailability } from "@/lib/services/calendar";
import { availabilitySchema } from "@/lib/validation/calendar";

export const GET = route("member", async ({ req, db }) => {
  const q = parseQuery(req, z.object({ employee_id: z.uuid().optional() }));
  return { items: await listAvailabilityRules(db, q.employee_id) };
});

export const POST = route("member", async ({ req, db, member }) => saveAvailability(db, member, await parseBody(req, availabilitySchema)));
