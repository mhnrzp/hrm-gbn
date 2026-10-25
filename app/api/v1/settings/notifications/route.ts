import { parseBody, route } from "@/lib/api";
import { updatePreferences } from "@/lib/services/settings";
import { preferencesPatchSchema } from "@/lib/validation/settings";

export const PATCH = route("member", async ({ req, db, member }) => updatePreferences(db, member, await parseBody(req, preferencesPatchSchema)));
