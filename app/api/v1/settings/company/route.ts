import { parseBody, route } from "@/lib/api";
import { updateCompany } from "@/lib/services/settings";
import { companyPatchSchema } from "@/lib/validation/settings";

export const PATCH = route("manager", async ({ req, db, member }) => {
  const patch = await parseBody(req, companyPatchSchema);
  return updateCompany(db, member, { ...patch, email: patch.email === "" ? null : patch.email });
});
