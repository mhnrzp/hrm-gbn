import { parseBody, route } from "@/lib/api";
import { inviteMember } from "@/lib/services/team";
import { inviteMemberSchema } from "@/lib/validation/team";

export const POST = route("manager", async ({ req, member }) => {
  const input = await parseBody(req, inviteMemberSchema);
  return inviteMember(member, input);
});
