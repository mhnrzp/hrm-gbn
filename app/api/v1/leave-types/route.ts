import { route } from "@/lib/api";
import { leaveTypes } from "@/lib/services/calendar";

export const GET = route("member", async ({ db }) => ({ items: await leaveTypes(db) }));
