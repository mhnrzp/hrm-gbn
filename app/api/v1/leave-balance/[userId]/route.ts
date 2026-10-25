import { route } from "@/lib/api";
import { leaveBalance } from "@/lib/services/calendar";
import { uuid } from "@/lib/validation/common";

// Self or managers only (enforced in leave_balance()).
export const GET = route<{ userId: string }>("member", async ({ db, params }) => leaveBalance(db, uuid.parse(params.userId)));
