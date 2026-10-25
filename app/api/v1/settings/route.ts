import { route } from "@/lib/api";
import { getSettings } from "@/lib/services/settings";

// Personal settings for everyone; company settings and access summary only for managers.
export const GET = route("member", async ({ db, member }) => getSettings(db, member));
