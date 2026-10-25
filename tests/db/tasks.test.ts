import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, expectCode, seedOrg, type Db } from "./harness";

let db: Db;
let a: Awaited<ReturnType<typeof seedOrg>>;
let b: Awaited<ReturnType<typeof seedOrg>>;
let sara: string, mina: string, hossein: string;

const day = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

async function createTask(actor: string, payload: Record<string, unknown>) {
  const res = await asUser(db, actor, () =>
    db.query<{ r: { task_id: string; occurrence_id: string; warnings: unknown[] } }>("select public.create_task($1) as r", [{ organization_id: a.org, ...payload }]),
  );
  return res.rows[0].r;
}

const occurrences = async (taskId: string) =>
  (await db.query<{ id: string; status: string; local_due_date: string; generation_key: string }>(
    "select id, status, local_due_date::text, generation_key from public.task_occurrences where task_id = $1 order by local_due_date",
    [taskId],
  )).rows;

beforeAll(async () => {
  db = await createDb();
  a = await seedOrg(db, { slug: "org-a", employees: ["Sara", "Mina", "Hossein"] });
  b = await seedOrg(db, { slug: "org-b", employees: ["Reza"] });
  [sara, mina, hossein] = a.employees;
});

describe("tasks", () => {
  it("TASK-01: one-off task → one series, one occurrence, assignee notified", async () => {
    const r = await createTask(a.manager, { title: "طراحی صفحه لندینگ", priority: "important", due_date: day(2), due_time: "17:00", assignee_ids: [sara] });
    expect(await occurrences(r.task_id)).toHaveLength(1);
    await db.query("select app.process_outbox()");
    const n = await asUser(db, sara, () => db.query<{ title_key: string; message_data: { task_title: string } }>("select title_key, message_data from public.notifications"));
    expect(n.rows).toEqual([{ title_key: "task.assigned", message_data: expect.objectContaining({ task_title: "طراحی صفحه لندینگ" }) }]);
    // Re-running the processor does not duplicate (NTF-01 style idempotency).
    await db.query("update public.outbox_events set processed_at = null");
    await db.query("select app.process_outbox()");
    expect((await asUser(db, sara, () => db.query("select id from public.notifications"))).rows).toHaveLength(1);
  });

  it("employees cannot create tasks or see other people's tasks", async () => {
    await expectCode(createTask(sara, { title: "x", due_date: day(1), assignee_ids: [sara] }), "FORBIDDEN");
    const r = await createTask(a.manager, { title: "Private to Mina", due_date: day(3), assignee_ids: [mina] });
    expect((await asUser(db, sara, () => db.query("select id from public.task_occurrences where task_id = $1", [r.task_id]))).rows).toHaveLength(0);
    expect((await asUser(db, mina, () => db.query("select id from public.task_occurrences where task_id = $1", [r.task_id]))).rows).toHaveLength(1);
    expect((await asUser(db, b.manager, () => db.query("select id from public.tasks where id = $1", [r.task_id]))).rows).toHaveLength(0);
    await expectCode(asUser(db, sara, () => db.query("select public.complete_occurrence($1)", [r.occurrence_id])), "NOT_FOUND");
  });

  it("assignees must be active members of the same organisation", async () => {
    await expectCode(createTask(a.manager, { title: "x", due_date: day(1), assignee_ids: [b.employees[0]] }), "MEMBER_INACTIVE");
  });

  it("TASK-02: team-pool claim succeeds once; second claimant gets TASK_ALREADY_CLAIMED", async () => {
    const r = await createTask(a.manager, { title: "Pool job", due_date: day(1), assignment_mode: "team_pool" });
    expect((await asUser(db, mina, () => db.query("select id from public.task_occurrences where id = $1", [r.occurrence_id]))).rows).toHaveLength(1);
    await asUser(db, sara, () => db.query("select public.claim_occurrence($1)", [r.occurrence_id]));
    await expectCode(asUser(db, mina, () => db.query("select public.claim_occurrence($1)", [r.occurrence_id])), "TASK_ALREADY_CLAIMED");
    // Once claimed it leaves Mina's queue.
    expect((await asUser(db, mina, () => db.query("select id from public.task_occurrences where id = $1", [r.occurrence_id]))).rows).toHaveLength(0);
  });

  it("TASK-03: completing one daily occurrence leaves the others open", async () => {
    const r = await createTask(a.manager, { title: "Daily standup notes", due_date: day(0), recurrence_type: "daily", assignee_ids: [sara] });
    const occ = await occurrences(r.task_id);
    expect(occ.length).toBeGreaterThanOrEqual(90);
    await asUser(db, sara, () => db.query("select public.complete_occurrence($1)", [occ[0].id]));
    const after = await occurrences(r.task_id);
    expect(after[0].status).toBe("completed");
    expect(after.slice(1).every((o) => o.status === "todo")).toBe(true);
  });

  it("TASK-04: all_assignees completes only when everyone is done", async () => {
    const r = await createTask(a.manager, { title: "Pair review", due_date: day(1), completion_policy: "all_assignees", assignee_ids: [sara, hossein] });
    expect((await asUser(db, sara, () => db.query<{ s: string }>("select public.complete_occurrence($1) as s", [r.occurrence_id]))).rows[0].s).toBe("in_progress");
    expect((await asUser(db, hossein, () => db.query<{ s: string }>("select public.complete_occurrence($1) as s", [r.occurrence_id]))).rows[0].s).toBe("completed");
    const row = (await db.query<{ completed_by: string }>("select completed_by from public.task_occurrences where id = $1", [r.occurrence_id])).rows[0];
    expect(row.completed_by).toBe(hossein);
  });

  it("any_one completes on the first completion", async () => {
    const r = await createTask(a.manager, { title: "Either of you", due_date: day(1), completion_policy: "any_one", assignee_ids: [sara, hossein] });
    expect((await asUser(db, sara, () => db.query<{ s: string }>("select public.complete_occurrence($1) as s", [r.occurrence_id]))).rows[0].s).toBe("completed");
  });

  it("TASK-05: past-due open occurrence is derived overdue on the board", async () => {
    await createTask(a.manager, { title: "Late report", due_date: day(-2), assignee_ids: [mina] });
    const rows = await asUser(db, mina, () => db.query<{ title: string; is_overdue: boolean }>("select title, is_overdue from public.task_board(p_status => 'overdue')"));
    expect(rows.rows.map((r) => r.title)).toContain("Late report");
    expect(rows.rows.every((r) => r.is_overdue)).toBe(true);
  });

  it("TASK-06: running the generator twice creates no duplicates", async () => {
    const r = await createTask(a.manager, { title: "Weekly sync", due_date: day(0), recurrence_type: "weekly", recurrence_days_of_week: [6, 1], assignee_ids: [mina] });
    const before = (await occurrences(r.task_id)).length;
    await db.query("select app.generate_task_occurrences()");
    await db.query("select app.generate_task_occurrences()");
    const after = await occurrences(r.task_id);
    expect(after.length).toBe(before);
    expect(new Set(after.map((o) => o.generation_key)).size).toBe(after.length);
  });

  it("TASK-07: editing a recurring series keeps completed history", async () => {
    const r = await createTask(a.manager, { title: "Backup check", due_date: day(-3), recurrence_type: "daily", assignee_ids: [hossein] });
    const occ = await occurrences(r.task_id);
    await asUser(db, hossein, () => db.query("select public.complete_occurrence($1)", [occ[0].id]));
    await asUser(db, a.manager, () => db.query("select public.update_task_series($1, $2)", [r.task_id, { recurrence_type: "weekly", recurrence_days_of_week: [3] }]));
    const after = await occurrences(r.task_id);
    expect(after.find((o) => o.id === occ[0].id)?.status).toBe("completed");
    const future = after.filter((o) => o.local_due_date > day(1) && o.status === "todo");
    // Future occurrences now follow the weekly (Wednesday) rule.
    expect(future.every((o) => new Date(`${o.local_due_date}T12:00:00Z`).getUTCDay() === 3)).toBe(true);
  });

  it("one-off reschedule moves the occurrence instead of duplicating it", async () => {
    const r = await createTask(a.manager, { title: "Move me", due_date: day(2), assignee_ids: [sara] });
    await asUser(db, sara, () => db.query("select public.update_my_progress($1, 30)", [r.occurrence_id]));
    await asUser(db, a.manager, () => db.query("select public.update_task_series($1, $2)", [r.task_id, { due_date: day(5) }]));
    const occ = await occurrences(r.task_id);
    expect(occ).toHaveLength(1);
    expect(occ[0].local_due_date).toBe(day(5));
    expect(occ[0].status).toBe("in_progress");
  });

  it("monthly recurrence follows Jalali months and clamps 31 Shahrivar to the month end", async () => {
    const rows = await db.query<{ jy: number; jm: number; jd: number }>(
      `select (app.to_jalali(d)).* from app.recurrence_dates(app.from_jalali(1405, 6, 31), 'monthly', 1, null, null, app.from_jalali(1405, 1, 1), app.from_jalali(1406, 1, 31)) d`,
    );
    expect(rows.rows.map((r) => `${r.jy}/${r.jm}/${r.jd}`)).toEqual([
      "1405/6/31", "1405/7/30", "1405/8/30", "1405/9/30", "1405/10/30", "1405/11/30", "1405/12/29", "1406/1/31",
    ]);
    // ۵ آبان stays on the 5th of every Jalali month (not the Gregorian date a month later).
    const fifth = await db.query<{ jd: number }>(
      `select (app.to_jalali(d)).jd from app.recurrence_dates(app.from_jalali(1405, 8, 5), 'monthly', 1, null, null, app.from_jalali(1405, 8, 1), app.from_jalali(1406, 2, 1)) d`,
    );
    expect(fifth.rows.every((r) => r.jd === 5)).toBe(true);
  });

  it("SQL Jalali conversion matches the browser's Persian calendar for every day 2020–2035", async () => {
    const res = await db.query<{ g: string; jy: number; jm: number; jd: number; back: string }>(
      `select d::date::text as g, j.jy, j.jm, j.jd, app.from_jalali(j.jy, j.jm, j.jd)::text as back
       from generate_series('2020-01-01'::date, '2035-12-31'::date, interval '1 day') d, lateral app.to_jalali(d::date) j`,
    );
    const fmt = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", { timeZone: "UTC", year: "numeric", month: "numeric", day: "numeric" });
    const mismatches = res.rows.filter((r) => {
      const p = fmt.formatToParts(new Date(`${r.g}T12:00:00Z`));
      const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
      return get("year") !== r.jy || get("month") !== r.jm || get("day") !== r.jd || r.back !== r.g;
    });
    expect(res.rows.length).toBeGreaterThan(5800);
    expect(mismatches.slice(0, 3)).toEqual([]);
  });

  it("progress + comments: assignee and manager only", async () => {
    const r = await createTask(a.manager, { title: "Write docs", due_date: day(4), assignee_ids: [sara] });
    await asUser(db, sara, () => db.query("select public.update_my_progress($1, 60, null, 'نسخه دسکتاپ آماده است')", [r.occurrence_id]));
    await asUser(db, a.manager, () => db.query("select public.add_task_comment($1, 'لطفاً حالت فرم تماس هم بررسی شود')", [r.occurrence_id]));
    await expectCode(asUser(db, mina, () => db.query("select public.add_task_comment($1, 'hi')", [r.occurrence_id])), "NOT_FOUND");
    const board = await asUser(db, sara, () => db.query<{ status: string; progress_percent: number }>("select status, progress_percent from public.task_board() where task_id = $1", [r.task_id]));
    expect(board.rows[0]).toEqual({ status: "in_progress", progress_percent: 60 });
    const updates = await asUser(db, sara, () => db.query("select update_type from public.task_updates where occurrence_id = $1", [r.occurrence_id]));
    expect(updates.rows).toHaveLength(2);
  });

  it("archive cancels untouched future occurrences and keeps history", async () => {
    const r = await createTask(a.manager, { title: "Retire me", due_date: day(-1), recurrence_type: "daily", assignee_ids: [mina] });
    const occ = await occurrences(r.task_id);
    await asUser(db, mina, () => db.query("select public.complete_occurrence($1)", [occ[0].id]));
    await asUser(db, a.manager, () => db.query("select public.archive_task($1)", [r.task_id]));
    const after = await occurrences(r.task_id);
    expect(after[0].status).toBe("completed");
    expect(after.filter((o) => o.local_due_date > day(1)).every((o) => o.status === "cancelled")).toBe(true);
  });
});
