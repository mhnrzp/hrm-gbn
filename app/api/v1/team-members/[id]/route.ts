import { parseBody, route } from "@/lib/api";
import { AppError, unwrap } from "@/lib/errors";
import { memberProfile, updateMember } from "@/lib/services/team";
import { updateMemberSchema } from "@/lib/validation/team";
import { uuid } from "@/lib/validation/common";
import { z } from "zod";

export const GET = route<{ id: string }>("member", async ({ db, params }) => memberProfile(db, uuid.parse(params.id)));

// Manager-only fields (role, status, title, work mode, quota, manager, start date, name, phone, avatar).
export const PATCH = route<{ id: string }>("manager", async ({ req, db, member, params }) => {
  const userId = uuid.parse(params.id);
  const body = await parseBody(req, updateMemberSchema.and(z.object({ avatar_path: z.string().max(300).nullable().optional() })));
  const { avatar_path, ...patch } = body;
  const m = unwrap(await db.from("organization_memberships").select("id").eq("organization_id", member.orgId).eq("user_id", userId).maybeSingle());
  if (!m) throw new AppError("NOT_FOUND");
  if (avatar_path !== undefined) {
    if (avatar_path && !avatar_path.startsWith(`${member.orgId}/${userId}/`)) throw new AppError("FORBIDDEN", { field: "avatar_path" });
    unwrap(await db.from("profiles").update({ avatar_path }).eq("id", userId).select("id"));
  }
  return Object.keys(patch).length ? updateMember(db, m.id, patch) : { membership_id: m.id };
});
