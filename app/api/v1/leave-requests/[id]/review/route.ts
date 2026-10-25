import { parseBody, route } from "@/lib/api";
import { reviewLeave } from "@/lib/services/calendar";
import { leaveReviewSchema } from "@/lib/validation/calendar";
import { uuid } from "@/lib/validation/common";

export const POST = route<{ id: string }>("manager", async ({ req, db, params }) => {
  const { decision, comment } = await parseBody(req, leaveReviewSchema);
  return reviewLeave(db, uuid.parse(params.id), decision, comment);
});
