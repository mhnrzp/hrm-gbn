import { route } from "@/lib/api";
import { getDashboard } from "@/lib/services/dashboard";

export const GET = route("member", async ({ db, member }) => getDashboard(db, member));
