import { parseQuery, route } from "@/lib/api";
import { checkAvailability } from "@/lib/services/calendar";
import { availabilityCheckSchema } from "@/lib/validation/calendar";

// approved_leave | already_scheduled_work | available | no_declared_availability (self or manager).
export const GET = route("member", async ({ req, db }) => {
  const q = parseQuery(req, availabilityCheckSchema);
  return checkAvailability(db, q.user_id, q.start, q.end);
});
