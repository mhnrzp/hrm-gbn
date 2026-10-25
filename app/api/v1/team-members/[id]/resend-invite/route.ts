import { route } from "@/lib/api";
import { AppError, unwrap } from "@/lib/errors";
import { resendInvitation } from "@/lib/services/team";
import { uuid } from "@/lib/validation/common";

export const POST = route<{ id: string }>("manager", async ({ db, member, params }) => {
  const m = unwrap(await db.from("organization_memberships").select("id").eq("organization_id", member.orgId).eq("user_id", uuid.parse(params.id)).maybeSingle());
  if (!m) throw new AppError("NOT_FOUND");
  return resendInvitation(member, m.id);
});
