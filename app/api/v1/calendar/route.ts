import { parseQuery, route } from "@/lib/api";
import { calendarFeed } from "@/lib/services/calendar";
import { calendarQuerySchema } from "@/lib/validation/calendar";

// Safe merged feed (tasks, meetings, leave, effective availability); max 92 days per request.
export const GET = route("member", async ({ req, db }) => {
  const q = parseQuery(req, calendarQuerySchema);
  return { items: await calendarFeed(db, q.from, q.to, q.employee_ids) };
});
