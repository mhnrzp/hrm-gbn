import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, expectCode, seedOrg, type Db } from "./harness";

let db: Db;
let a: Awaited<ReturnType<typeof seedOrg>>;
let sara: string, mina: string, reza: string;
let annualType: string;

/** A date `offset` days from today that is not a Friday (org weekend), as YYYY-MM-DD. */
function workday(offset: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  while (d.getUTCDay() === 5) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const tehran = (date: string, time: string) => `${date}T${time}:00+03:30`;

async function rpc<T>(user: string, sql: string, params: unknown[] = []) {
  return (await asUser(db, user, () => db.query<{ r: T }>(sql, params))).rows[0].r;
}

beforeAll(async () => {
  db = await createDb();
  a = await seedOrg(db, { slug: "cal-org", employees: ["سارا محمدی", "مینا کریمی", "رضا موسوی"] });
  [sara, mina, reza] = a.employees;
  annualType = (await db.query<{ id: string }>("select id from public.leave_types where organization_id = $1 and code = 'annual'", [a.org])).rows[0].id;
});

describe("leave workflow", () => {
  it("LEAVE-01: request overlapping a deadline warns the manager", async () => {
    const due = workday(10);
    await rpc(a.manager, "select public.create_task($1) as r", [{ organization_id: a.org, title: "گزارش ماهانه", due_date: due, assignee_ids: [mina] }]);
    const res = await rpc<{ status: string; task_conflicts: { kind: string }[] }>(mina, "select public.submit_leave($1) as r", [
      { organization_id: a.org, leave_type_id: annualType, start_date: due, end_date: due, reason: "امور شخصی" },
    ]);
    expect(res.status).toBe("pending");
    expect(res.task_conflicts.map((c) => c.kind)).toEqual(["deadline_during_leave"]);
    await db.query("select app.process_outbox()");
    const n = await asUser(db, a.manager, () => db.query<{ title_key: string; message_data: { conflicting_task_count: number } }>("select title_key, message_data from public.notifications where title_key = 'leave.requested'"));
    expect(n.rows[0].message_data.conflicting_task_count).toBe(1);
  });

  it("LEAVE-02/05: approval shows a red block; co-workers see timing but never the reason", async () => {
    const day = workday(14);
    const { leave_request_id: id } = await rpc<{ leave_request_id: string }>(sara, "select public.submit_leave($1) as r", [
      { organization_id: a.org, leave_type_id: annualType, start_date: day, end_date: day, reason: "رسیدگی به امور خانوادگی" },
    ]);
    const reviewed = await rpc<{ status: string }>(a.manager, "select public.review_leave($1, 'approve', 'تأیید شد') as r", [id]);
    expect(reviewed.status).toBe("approved");

    const feed = await asUser(db, reza, () =>
      db.query<{ type: string; status: string; meta: Record<string, unknown> }>("select type, status, meta from public.calendar_feed($1, $2) where id = $3", [tehran(day, "00:00"), tehran(workday(16), "00:00"), id]),
    );
    expect(feed.rows).toEqual([{ type: "leave", status: "approved", meta: { all_day: true } }]);
    expect(JSON.stringify(feed.rows)).not.toContain("خانوادگی");
    // Direct reads of the request row are denied to co-workers.
    expect((await asUser(db, reza, () => db.query("select reason_private from public.leave_requests where id = $1", [id]))).rows).toHaveLength(0);
    // Manager sees the type.
    const mgr = await asUser(db, a.manager, () => db.query<{ meta: { leave_type: string } }>("select meta from public.calendar_feed($1, $2) where id = $3", [tehran(day, "00:00"), tehran(workday(16), "00:00"), id]));
    expect(mgr.rows[0].meta.leave_type).toBe("استحقاقی");
  });

  it("LEAVE-03: employees cannot review; managers cannot self-approve ordinary requests", async () => {
    const day = workday(20);
    const { leave_request_id: id } = await rpc<{ leave_request_id: string }>(reza, "select public.submit_leave($1) as r", [
      { organization_id: a.org, leave_type_id: annualType, start_date: day, end_date: day, reason: "x" },
    ]);
    await expectCode(rpc(reza, "select public.review_leave($1, 'approve') as r", [id]), "NOT_FOUND");
    await expectCode(rpc(sara, "select public.review_leave($1, 'approve') as r", [id]), "NOT_FOUND");
    const own = await rpc<{ leave_request_id: string }>(a.manager, "select public.submit_leave($1) as r", [
      { organization_id: a.org, leave_type_id: annualType, start_date: day, end_date: day, reason: "x" },
    ]);
    await expectCode(rpc(a.manager, "select public.review_leave($1, 'approve') as r", [own.leave_request_id]), "FORBIDDEN");
    // Explicit, audited override is allowed.
    const override = await rpc<{ status: string; leave_request_id: string }>(a.manager, "select public.submit_leave($1) as r", [
      { organization_id: a.org, leave_type_id: annualType, start_date: workday(40), end_date: workday(40), reason: "x", approve_now: true },
    ]);
    expect(override.status).toBe("approved");
    const flag = (await db.query<{ is_manager_override: boolean }>("select is_manager_override from public.leave_requests where id = $1", [override.leave_request_id])).rows[0];
    expect(flag.is_manager_override).toBe(true);
    // An employee cannot use the override.
    await expectCode(rpc(reza, "select public.submit_leave($1) as r", [{ organization_id: a.org, leave_type_id: annualType, start_date: day, end_date: day, reason: "x", approve_now: true }]), "FORBIDDEN");
  });

  it("LEAVE-04: a second review of the same request is rejected", async () => {
    const day = workday(22);
    const { leave_request_id: id } = await rpc<{ leave_request_id: string }>(mina, "select public.submit_leave($1) as r", [
      { organization_id: a.org, leave_type_id: annualType, start_date: day, end_date: day, reason: "x" },
    ]);
    await rpc(a.manager, "select public.review_leave($1, 'reject', 'حجم کار بالاست') as r", [id]);
    await expectCode(rpc(a.manager, "select public.review_leave($1, 'approve') as r", [id]), "LEAVE_ALREADY_REVIEWED");
  });

  it("rejection requires a reason; overlapping approved leave is refused", async () => {
    const day = workday(25);
    const r1 = await rpc<{ leave_request_id: string }>(sara, "select public.submit_leave($1) as r", [{ organization_id: a.org, leave_type_id: annualType, start_date: day, end_date: day, reason: "x" }]);
    const r2 = await rpc<{ leave_request_id: string }>(sara, "select public.submit_leave($1) as r", [{ organization_id: a.org, leave_type_id: annualType, start_date: day, end_date: day, reason: "y" }]);
    await expectCode(rpc(a.manager, "select public.review_leave($1, 'reject', '') as r", [r1.leave_request_id]), "VALIDATION_FAILED");
    await rpc(a.manager, "select public.review_leave($1, 'approve') as r", [r1.leave_request_id]);
    await expectCode(rpc(a.manager, "select public.review_leave($1, 'approve') as r", [r2.leave_request_id]), "LEAVE_OVERLAP");
  });

  it("balance: quota minus approved working days of the current Jalali year", async () => {
    const before = await rpc<{ quota_days: number; used_days: number; remaining_days: number }>(sara, "select public.leave_balance($1) as r", [sara]);
    expect(Number(before.quota_days)).toBe(26);
    expect(Number(before.used_days)).toBeGreaterThanOrEqual(1);
    await expectCode(rpc(mina, "select public.leave_balance($1) as r", [sara]), "NOT_FOUND");
    const days = await db.query<{ n: string }>("select app.leave_days($1, '2026-10-17', '2026-10-23') as n", [a.org]);
    expect(Number(days.rows[0].n)).toBe(6); // Sat..Fri minus Friday
  });

  it("task assignment warns when the assignee is on approved leave", async () => {
    const leaveDay = workday(14); // Sara's approved leave from LEAVE-02
    const res = await rpc<{ warnings: { full_name: string; kind: string }[] }>(a.manager, "select public.create_task($1) as r", [
      { organization_id: a.org, title: "تسک حین مرخصی", due_date: leaveDay, due_time: "12:00", assignee_ids: [sara] },
    ]);
    expect(res.warnings).toEqual([expect.objectContaining({ full_name: "سارا محمدی", kind: "approved_leave" })]);
  });
});

describe("availability", () => {
  it("AVAIL-01/02/03: weekly free time, minus approved leave; undeclared stays unknown", async () => {
    const start = workday(1);
    const res = await rpc<{ occurrences: number }>(reza, "select public.save_availability($1) as r", [
      { organization_id: a.org, start_date: start, start_time: "13:00", end_time: "16:00", recurrence_type: "weekly", note: "زمان مناسب برای جلسه" },
    ]);
    expect(res.occurrences).toBeGreaterThanOrEqual(12);

    const nextWeek = new Date(`${start}T12:00:00Z`);
    nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
    const leaveDay = nextWeek.toISOString().slice(0, 10);
    await rpc(a.manager, "select public.submit_leave($1) as r", [{ organization_id: a.org, employee_id: reza, leave_type_id: annualType, start_date: leaveDay, end_date: leaveDay, reason: "x", approve_now: true }]);

    const feed = await asUser(db, sara, () =>
      db.query<{ type: string; start_at: string }>("select type, start_at::text from public.calendar_feed($1, $2, $3) where type = 'availability'", [tehran(start, "00:00"), tehran(leaveDay, "23:59"), [reza]]),
    );
    expect(feed.rows.length).toBe(1); // the week-2 block is swallowed by approved leave

    const status = (await db.query<{ s: string }>("select app.availability_status($1, $2, $3) as s", [mina, tehran(start, "13:00"), tehran(start, "14:00")])).rows[0].s;
    expect(status).toBe("no_declared_availability");
    const free = (await db.query<{ s: string }>("select app.availability_status($1, $2, $3) as s", [reza, tehran(start, "13:30"), tehran(start, "14:30")])).rows[0].s;
    expect(free).toBe("available");
  });
});

describe("meetings", () => {
  it("conflicting meeting is not saved; a free slot is suggested; force saves", async () => {
    const day = workday(5);
    await rpc(a.manager, "select public.create_task($1) as r", [
      { organization_id: a.org, title: "طراحی صفحه لندینگ", start_date: day, start_time: "09:00", due_date: day, due_time: "12:00", assignee_ids: [sara] },
    ]);
    const attempt = await rpc<{ saved: boolean; conflicts: { full_name: string }[]; suggested: { start_at: string } | null }>(a.manager, "select public.save_event($1) as r", [
      { organization_id: a.org, title: "جلسه بازبینی طراحی", start_at: tehran(day, "10:00"), end_at: tehran(day, "11:00"), attendee_ids: [sara] },
    ]);
    expect(attempt.saved).toBe(false);
    expect(attempt.conflicts[0].full_name).toBe("سارا محمدی");
    expect(attempt.suggested).not.toBeNull();
    const forced = await rpc<{ saved: boolean; event_id: string }>(a.manager, "select public.save_event($1) as r", [
      { organization_id: a.org, title: "جلسه بازبینی طراحی", location: "اتاق جلسه", start_at: tehran(day, "10:00"), end_at: tehran(day, "11:00"), attendee_ids: [sara], force: true },
    ]);
    expect(forced.saved).toBe(true);

    const panel = await rpc<{ kind: string; full_name: string }[]>(a.manager, "select public.schedule_conflicts($1, $2) as r", [tehran(day, "00:00"), tehran(day, "23:59")]);
    expect(panel.some((c) => c.kind === "meeting_overlap" && c.full_name === "سارا محمدی")).toBe(true);

    // Non-participants see a generic busy block; participants see the title.
    const forReza = await asUser(db, reza, () => db.query<{ title: string }>("select title from public.calendar_feed($1, $2) where id = $3", [tehran(day, "00:00"), tehran(day, "23:59"), forced.event_id]));
    expect(forReza.rows[0].title).toBe("جلسه");
    const forSara = await asUser(db, sara, () => db.query<{ title: string }>("select title from public.calendar_feed($1, $2) where id = $3", [tehran(day, "00:00"), tehran(day, "23:59"), forced.event_id]));
    expect(forSara.rows[0].title).toBe("جلسه بازبینی طراحی");
    // Employees cannot create meetings.
    await expectCode(rpc(sara, "select public.save_event($1) as r", [{ organization_id: a.org, title: "x", start_at: tehran(day, "15:00"), end_at: tehran(day, "16:00"), attendee_ids: [mina] }]), "FORBIDDEN");
  });

  it("feed rejects ranges over 92 days and hides others' tasks from employees", async () => {
    await expectCode(asUser(db, sara, () => db.query("select * from public.calendar_feed(now(), now() + interval '120 days')")), "CALENDAR_RANGE_TOO_LARGE");
    const rows = await asUser(db, sara, () => db.query<{ employee_id: string }>("select employee_id from public.calendar_feed(now() - interval '1 day', now() + interval '60 days') where type = 'task'"));
    expect(rows.rows.every((r) => r.employee_id === sara)).toBe(true);
  });
});
