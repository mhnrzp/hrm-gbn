import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, expectCode, seedOrg, type Db } from "./harness";

let db: Db;
let a: Awaited<ReturnType<typeof seedOrg>>;
let sara: string, mina: string;

const day = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
async function rpc<T>(user: string, sql: string, params: unknown[] = []) {
  return (await asUser(db, user, () => db.query<{ r: T }>(sql, params))).rows[0].r;
}
const inbox = async (user: string, key: string) =>
  (await asUser(db, user, () => db.query<{ id: string }>("select id from public.notifications where title_key = $1", [key]))).rows.length;

beforeAll(async () => {
  db = await createDb();
  a = await seedOrg(db, { slug: "jobs-org", employees: ["Sara", "Mina"] });
  [sara, mina] = a.employees;
});

describe("scheduled jobs", () => {
  it("TASK-05 + NTF-01: overdue alert is sent once, however often the scan runs", async () => {
    await rpc(a.manager, "select public.create_task($1) as r", [{ organization_id: a.org, title: "Late", due_date: day(-1), due_time: "09:00", assignee_ids: [sara] }]);
    for (let i = 0; i < 3; i++) {
      await db.query("select app.run_job('scan_task_reminders', 'select app.scan_task_reminders()')");
      await db.query("select app.process_outbox()");
    }
    expect(await inbox(sara, "task.overdue")).toBe(1);
    expect(await inbox(a.manager, "task.overdue")).toBe(1);
    const runs = (await db.query<{ status: string }>("select status from public.job_runs where job_name = 'scan_task_reminders'")).rows;
    expect(runs.every((r) => r.status === "succeeded")).toBe(true);
  });

  it("due-soon reminders honour the assignee's preference", async () => {
    const soon = new Date(Date.now() + 6 * 3600_000).toISOString();
    await rpc(a.manager, "select public.create_task($1) as r", [
      { organization_id: a.org, title: "Soon", due_date: soon.slice(0, 10), due_time: "23:30", assignee_ids: [sara, mina] },
    ]);
    await db.query("insert into public.member_preferences (organization_id, user_id, task_reminder_enabled) values ($1, $2, false) on conflict (organization_id, user_id) do update set task_reminder_enabled = false", [a.org, mina]);
    await db.query("select app.scan_task_reminders()");
    await db.query("select app.process_outbox()");
    const saraSoon = await inbox(sara, "task.due_soon");
    expect(await inbox(mina, "task.due_soon")).toBe(0);
    expect(saraSoon).toBeLessThanOrEqual(1); // depends on clock vs 23:30 Tehran; never duplicated
  });

  it("INV-05: overdue invoice alerts managers once; employees never", async () => {
    await rpc(a.manager, "select public.create_invoice($1) as r", [{ title: "Hosting", supplier_name: "Abr", amount_irr: "125000000", due_date: day(-1) }]);
    await db.query("select app.scan_invoice_reminders()");
    await db.query("select app.scan_invoice_reminders()");
    await db.query("select app.process_outbox()");
    expect(await inbox(a.manager, "invoice.overdue")).toBe(1);
    expect(await inbox(sara, "invoice.overdue")).toBe(0);
  });

  it("failed job bodies are recorded, not thrown", async () => {
    await db.query("select app.run_job('broken', 'select 1/0')");
    const r = (await db.query<{ status: string; error_code: string }>("select status, error_code from public.job_runs where job_name = 'broken'")).rows[0];
    expect(r).toEqual({ status: "failed", error_code: "22012" });
  });

  it("cron schedules are registered", async () => {
    const jobs = (await db.query<{ jobname: string }>("select jobname from cron.job order by 1")).rows.map((r) => r.jobname);
    expect(jobs).toEqual(expect.arrayContaining(["process_outbox", "generate_task_occurrences", "scan_task_reminders", "scan_invoice_reminders", "weekly_digest"]));
  });
});

describe("files", () => {
  it("FILE-01: invoice attachments are reachable by managers only", async () => {
    const { invoice_id: inv } = await rpc<{ invoice_id: string }>(a.manager, "select public.create_invoice($1) as r", [{ title: "Doc", supplier_name: "S", amount_irr: "10", due_date: day(3) }]);
    const prep = await rpc<{ attachment_id: string; storage_path: string }>(a.manager, "select public.prepare_attachment('invoice', $1, 'factor.pdf', 'application/pdf', 1000) as r", [inv]);
    expect(prep.storage_path.startsWith(`${a.org}/invoice/${inv}/`)).toBe(true);
    expect(await rpc<string>(a.manager, "select public.attachment_path($1) as r", [prep.attachment_id])).toBe(prep.storage_path);
    await expectCode(rpc(sara, "select public.attachment_path($1) as r", [prep.attachment_id]), "NOT_FOUND");
    await expectCode(rpc(sara, "select public.prepare_attachment('invoice', $1, 'x.pdf', 'application/pdf', 10) as r", [inv]), "NOT_FOUND");
    expect((await asUser(db, sara, () => db.query("select id from public.attachments"))).rows).toHaveLength(0);
  });

  it("type and size limits are enforced; assignees may attach to their task", async () => {
    const t = await rpc<{ occurrence_id: string }>(a.manager, "select public.create_task($1) as r", [{ organization_id: a.org, title: "With file", due_date: day(2), assignee_ids: [sara] }]);
    await expectCode(rpc(sara, "select public.prepare_attachment('task_occurrence', $1, 'a.exe', 'application/x-msdownload', 10) as r", [t.occurrence_id]), "FILE_TYPE_NOT_ALLOWED");
    await expectCode(rpc(sara, "select public.prepare_attachment('task_occurrence', $1, 'a.pdf', 'application/pdf', 20000000) as r", [t.occurrence_id]), "FILE_TOO_LARGE");
    const ok = await rpc<{ attachment_id: string }>(sara, "select public.prepare_attachment('task_occurrence', $1, '../../etc/passwd.pdf', 'application/pdf', 10) as r", [t.occurrence_id]);
    const name = (await db.query<{ file_name: string }>("select file_name from public.attachments where id = $1", [ok.attachment_id])).rows[0].file_name;
    expect(name).not.toContain("/");
    await expectCode(rpc(mina, "select public.attachment_path($1) as r", [ok.attachment_id]), "NOT_FOUND");
  });

  it("avatar storage: own folder writable, other people's folders not", async () => {
    await asUser(db, sara, () => db.query("insert into storage.objects (bucket_id, name, owner) values ('avatars', $1, $2)", [`${a.org}/${sara}/me.png`, sara]));
    await expect(
      asUser(db, sara, () => db.query("insert into storage.objects (bucket_id, name, owner) values ('avatars', $1, $2)", [`${a.org}/${mina}/x.png`, sara])),
    ).rejects.toThrow(/row-level security/);
    // Managers may set a member's avatar (Figma «افزودن کارمند» upload).
    await asUser(db, a.manager, () => db.query("insert into storage.objects (bucket_id, name, owner) values ('avatars', $1, $2)", [`${a.org}/${mina}/m.png`, a.manager]));
    const visible = await asUser(db, mina, () => db.query("select name from storage.objects where bucket_id = 'avatars'"));
    expect(visible.rows.length).toBe(2);
  });
});
