import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, expectCode, seedOrg, type Db } from "./harness";

let db: Db;
let a: Awaited<ReturnType<typeof seedOrg>>;
let sara: string, mina: string;

beforeAll(async () => {
  db = await createDb();
  a = await seedOrg(db, { slug: "read-org", employees: ["Sara", "Mina"] });
  [sara, mina] = a.employees;
  await db.query("update public.profile_private set phone = '09121112233' where user_id = $1", [sara]);
});

describe("read models", () => {
  it("team directory hides contact data and task load from co-workers", async () => {
    const asMina = await asUser(db, mina, () => db.query<{ user_id: string; phone: string | null; email: string | null; active_task_count: number | null }>("select user_id, phone, email, active_task_count from public.team_directory()"));
    const saraRow = asMina.rows.find((r) => r.user_id === sara)!;
    expect(saraRow).toMatchObject({ phone: null, email: null, active_task_count: null });
    const asMgr = await asUser(db, a.manager, () => db.query<{ user_id: string; phone: string | null }>("select user_id, phone from public.team_directory()"));
    expect(asMgr.rows.find((r) => r.user_id === sara)!.phone).toBe("09121112233");
  });

  it("member profile private sections: self and managers only", async () => {
    const peer = await asUser(db, mina, () => db.query<{ r: { contact: unknown; can_view_private: boolean } }>("select public.member_profile($1) as r", [sara]));
    expect(peer.rows[0].r).toMatchObject({ contact: null, can_view_private: false });
    const self = await asUser(db, sara, () => db.query<{ r: { contact: { phone: string } } }>("select public.member_profile($1) as r", [sara]));
    expect(self.rows[0].r.contact.phone).toBe("09121112233");
  });

  it("audit feed: managers only, with readable labels", async () => {
    await asUser(db, a.manager, () => db.query("select public.create_task($1)", [{ organization_id: a.org, title: "طراحی صفحه لندینگ", due_date: "2030-01-01", assignee_ids: [sara] }]));
    const rows = await asUser(db, a.manager, () => db.query<{ action: string; entity_label: string; actor_name: string }>("select action, entity_label, actor_name from public.audit_feed(10)"));
    expect(rows.rows.find((r) => r.action === "tasks.insert")).toMatchObject({ entity_label: "طراحی صفحه لندینگ", actor_name: "Manager read-org" });
    await expectCode(asUser(db, sara, () => db.query("select * from public.audit_feed(10)")), "FORBIDDEN");
  });
});
