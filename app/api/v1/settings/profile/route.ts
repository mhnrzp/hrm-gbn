import { parseBody, route } from "@/lib/api";
import { updateProfile } from "@/lib/services/settings";
import { profilePatchSchema } from "@/lib/validation/settings";

// Own name / phone / avatar only. Role, organisation and email cannot be changed here (AUTH-05).
export const PATCH = route("member", async ({ req, db, member }) => updateProfile(db, member, await parseBody(req, profilePatchSchema)));
