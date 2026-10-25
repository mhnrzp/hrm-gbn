import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Member } from "@/lib/auth";
import { listBoard } from "./tasks";
import { listInvoices } from "./invoices";
import { teamDirectory } from "./team";

export type SearchResult = { type: "task" | "member" | "invoice"; id: string; title: string; subtitle: string; href: string };

/** Header search: role-filtered (RLS for tasks, directory projection for people, invoices for managers only). */
export async function search(db: SupabaseClient, member: Member, q: string): Promise<SearchResult[]> {
  const needle = q.trim().toLocaleLowerCase("fa");
  const [tasks, people, invoices] = await Promise.all([
    listBoard(db, { q, limit: 5 }),
    teamDirectory(db),
    member.role === "manager" ? listInvoices(db, { q, limit: 5 }) : Promise.resolve(null),
  ]);
  return [
    ...tasks.rows.map((t) => ({ type: "task" as const, id: t.occurrence_id, title: t.title, subtitle: "تسک", href: `/tasks?q=${encodeURIComponent(t.title)}` })),
    ...people
      .filter((p) => p.full_name.toLocaleLowerCase("fa").includes(needle) || p.job_title.toLocaleLowerCase("fa").includes(needle))
      .slice(0, 5)
      .map((p) => ({ type: "member" as const, id: p.user_id, title: p.full_name, subtitle: p.job_title || "عضو تیم", href: `/team/${p.user_id}` })),
    ...(invoices?.rows ?? []).map((i) => ({ type: "invoice" as const, id: i.id, title: i.title, subtitle: `صورت‌حساب • ${i.supplier_name}`, href: `/invoices?q=${encodeURIComponent(i.title)}` })),
  ];
}
