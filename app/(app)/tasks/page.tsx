import { requirePageMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { boardCounts, listBoard } from "@/lib/services/tasks";
import { listMemberOptions } from "@/lib/services/team";
import { boardQuerySchema } from "@/lib/validation/tasks";
import { TasksView } from "@/components/tasks/tasks-view";

export const metadata = { title: "مدیریت تسک‌ها | GBN HRM" };

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const member = await requirePageMember();
  const raw = await searchParams;
  const view = raw.view === "kanban" ? "kanban" : "list";
  const parsed = boardQuerySchema.safeParse(Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string")));
  const query = parsed.success ? parsed.data : boardQuerySchema.parse({});
  const db = await createClient();

  const [board, counts, members] = await Promise.all([
    listBoard(db, view === "kanban" ? { ...query, status: undefined, page: 1, limit: 100 } : query),
    boardCounts(db),
    listMemberOptions(db, member.orgId),
  ]);

  return (
    <TasksView
      rows={board.rows}
      total={board.total}
      counts={counts}
      query={query}
      view={view}
      members={members}
      me={{ userId: member.userId, role: member.role, timezone: member.org.timezone }}
    />
  );
}
