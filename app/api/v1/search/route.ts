import { z } from "zod";
import { parseQuery, route } from "@/lib/api";
import { search } from "@/lib/services/search";

export const GET = route("member", async ({ req, db, member }) => {
  const { q } = parseQuery(req, z.object({ q: z.string().trim().min(2).max(100) }));
  return { items: await search(db, member, q) };
});
