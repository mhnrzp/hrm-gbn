import { parseQuery, route } from "@/lib/api";
import { boardCounts, listBoard } from "@/lib/services/tasks";
import { boardQuerySchema } from "@/lib/validation/tasks";

// Board read model: current occurrence per series, filtered; counts for the status chips.
export const GET = route("member", async ({ req, db }) => {
  const q = parseQuery(req, boardQuerySchema);
  const [{ rows, total }, counts] = await Promise.all([listBoard(db, q), boardCounts(db)]);
  return { items: rows.map(({ total_count: _, ...r }) => r), total, page: q.page, limit: q.limit, counts };
});
