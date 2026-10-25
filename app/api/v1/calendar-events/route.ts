import { parseBody, route } from "@/lib/api";
import { saveEvent } from "@/lib/services/calendar";
import { eventSchema } from "@/lib/validation/calendar";

// Returns {saved:false, conflicts, suggested} instead of saving when attendees are busy (unless force).
export const POST = route("manager", async ({ req, db, member }) => saveEvent(db, member, await parseBody(req, eventSchema)));
