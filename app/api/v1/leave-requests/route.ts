import { parseBody, parseQuery, route } from "@/lib/api";
import { listLeaveRequests, submitLeave } from "@/lib/services/calendar";
import { leaveListSchema, leaveSubmitSchema } from "@/lib/validation/calendar";

// Employees: own requests. Managers: the team (RLS decides; reasons never reach co-workers).
export const GET = route("member", async ({ req, db }) => ({ items: await listLeaveRequests(db, parseQuery(req, leaveListSchema)) }));

export const POST = route("member", async ({ req, db, member }) => submitLeave(db, member, await parseBody(req, leaveSubmitSchema)));
