import { z } from "zod";
import { parseQuery, route } from "@/lib/api";
import { teamDirectory } from "@/lib/services/team";

// Managers: full list (incl. contact data); employees: minimal public directory.
export const GET = route("member", async ({ req, db, member }) => {
  const q = parseQuery(req, z.object({ include_inactive: z.enum(["true", "false"]).optional() }));
  return { items: await teamDirectory(db, member.role === "manager" && q.include_inactive === "true") };
});
