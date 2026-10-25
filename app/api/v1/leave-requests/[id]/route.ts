import { parseBody, route } from "@/lib/api";
import { getLeaveRequest, updateLeave } from "@/lib/services/calendar";
import { leavePatchSchema } from "@/lib/validation/calendar";
import { uuid } from "@/lib/validation/common";

export const GET = route<{ id: string }>("member", async ({ db, params }) => getLeaveRequest(db, uuid.parse(params.id)));

// Owner edits / cancels a pending request; managers may cancel approved leave.
export const PATCH = route<{ id: string }>("member", async ({ req, db, params }) => updateLeave(db, uuid.parse(params.id), await parseBody(req, leavePatchSchema)));
