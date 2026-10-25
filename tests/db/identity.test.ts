import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, createUser, expectCode, seedOrg, type Db } from "./harness";

let db: Db;
let a: Awaited<ReturnType<typeof seedOrg>>;
let b: Awaited<ReturnType<typeof seedOrg>>;

beforeAll(async () => {
  db = await createDb();
  a = await seedOrg(db, { slug: "org-a", employees: ["Sara", "Mina"] });
  b = await seedOrg(db, { slug: "org-b", employees: ["Reza"] });
  await db.query("update public.profile_private set phone = '09120000000' where user_id = $1", [a.employees[0]]);
});

describe("identity & membership RLS", () => {
  it("AUTH-01: anonymous callers see nothing", async () => {
    await expect(asUser(db, null, () => db.query("select * from public.organizations"))).rejects.toThrow(/permission denied/);
  });

  it("AUTH-06: a member never sees another organisation's rows", async () => {
    const orgs = await asUser(db, a.employees[0], () => db.query<{ id: string }>("select id from public.organizations"));
    expect(orgs.rows.map((r) => r.id)).toEqual([a.org]);
    const members = await asUser(db, a.employees[0], () => db.query<{ organization_id: string }>("select organization_id from public.organization_memberships"));
    expect(new Set(members.rows.map((r) => r.organization_id))).toEqual(new Set([a.org]));
    const crossProfile = await asUser(db, a.employees[0], () => db.query("select id from public.profiles where id = $1", [b.employees[0]]));
    expect(crossProfile.rows).toHaveLength(0);
  });

  it("private contact data: own + managers only", async () => {
    const own = await asUser(db, a.employees[0], () => db.query<{ phone: string }>("select phone from public.profile_private where user_id = $1", [a.employees[0]]));
    expect(own.rows[0].phone).toBe("09120000000");
    const peer = await asUser(db, a.employees[1], () => db.query("select phone from public.profile_private where user_id = $1", [a.employees[0]]));
    expect(peer.rows).toHaveLength(0);
    const mgr = await asUser(db, a.manager, () => db.query("select phone from public.profile_private where user_id = $1", [a.employees[0]]));
    expect(mgr.rows).toHaveLength(1);
    const otherMgr = await asUser(db, b.manager, () => db.query("select phone from public.profile_private where user_id = $1", [a.employees[0]]));
    expect(otherMgr.rows).toHaveLength(0);
  });

  it("leave quota column is not directly selectable", async () => {
    await expect(asUser(db, a.manager, () => db.query("select annual_leave_quota_days from public.organization_memberships"))).rejects.toThrow(/permission denied/);
  });

  it("AUTH-05: an employee cannot change their own role", async () => {
    await expect(
      asUser(db, a.employees[0], () => db.query("update public.organization_memberships set role = 'manager' where user_id = $1", [a.employees[0]])),
    ).rejects.toThrow(/permission denied/);
    await expectCode(
      asUser(db, a.employees[0], () => db.query("select public.update_member(id, '{\"role\":\"manager\"}') from public.organization_memberships where user_id = $1", [a.employees[0]])),
      "NOT_FOUND",
    );
  });

  it("manager edits members through update_member; last manager is protected", async () => {
    const memberId = (await db.query<{ id: string }>("select id from public.organization_memberships where user_id = $1", [a.employees[1]])).rows[0].id;
    await asUser(db, a.manager, () => db.query("select public.update_member($1, $2)", [memberId, { job_title: "Designer", work_mode: "remote" }]));
    const row = (await db.query<{ job_title: string; work_mode: string }>("select job_title, work_mode from public.organization_memberships where id = $1", [memberId])).rows[0];
    expect(row).toEqual({ job_title: "Designer", work_mode: "remote" });

    const mgrMembership = (await db.query<{ id: string }>("select id from public.organization_memberships where user_id = $1", [a.manager])).rows[0].id;
    await expectCode(asUser(db, a.manager, () => db.query("select public.update_member($1, $2)", [mgrMembership, { role: "employee" }])), "LAST_MANAGER");

    await expectCode(asUser(db, b.manager, () => db.query("select public.update_member($1, $2)", [memberId, { job_title: "x" }])), "NOT_FOUND");
  });

  it("AUTH-04: deactivation removes access immediately", async () => {
    const victim = await createUser(db, "Temp");
    await db.query("insert into public.organization_memberships (organization_id, user_id, role, status) values ($1, $2, 'employee', 'active')", [a.org, victim]);
    const memberId = (await db.query<{ id: string }>("select id from public.organization_memberships where user_id = $1", [victim])).rows[0].id;
    expect((await asUser(db, victim, () => db.query("select id from public.organizations"))).rows).toHaveLength(1);
    await asUser(db, a.manager, () => db.query("select public.update_member($1, $2)", [memberId, { status: "inactive" }]));
    expect((await asUser(db, victim, () => db.query("select id from public.organizations"))).rows).toHaveLength(0);
    const audit = await db.query<{ action: string }>("select action from public.audit_logs where entity_id = $1 order by id", [memberId]);
    expect(audit.rows.map((r) => r.action)).toContain("organization_memberships.update");
  });

  it("invitation acceptance activates the membership exactly once", async () => {
    const invitee = await createUser(db, "Invitee", "new@example.test");
    await db.exec("set role service_role");
    await db.query("select public.register_invited_member($1, $2, $3, 'new@example.test', 'employee', 'Narges', 'Writer', '', null, true)", [a.org, invitee, a.manager]);
    await db.exec("reset role");
    const before = (await db.query<{ status: string }>("select status from public.organization_memberships where user_id = $1", [invitee])).rows[0];
    expect(before.status).toBe("invited");
    await asUser(db, invitee, () => db.query("select public.accept_invitation()"));
    await asUser(db, invitee, () => db.query("select public.accept_invitation()"));
    const after = (await db.query<{ status: string }>("select status from public.organization_memberships where user_id = $1", [invitee])).rows[0];
    expect(after.status).toBe("active");
  });

  it("register_invited_member is not callable by regular users", async () => {
    await expect(
      asUser(db, a.manager, () => db.query("select public.register_invited_member($1, $2, $3, 'x@example.test', 'employee', 'X', '', '', null, true)", [a.org, a.employees[0], a.manager])),
    ).rejects.toThrow(/permission denied/);
  });

  it("notifications: recipient-only", async () => {
    await db.query("insert into public.notifications (organization_id, recipient_user_id, type, entity_type, title_key, dedupe_key) values ($1, $2, 'x', 'x', 'x', 'k1')", [a.org, a.employees[0]]);
    expect((await asUser(db, a.employees[0], () => db.query("select id from public.notifications"))).rows).toHaveLength(1);
    expect((await asUser(db, a.employees[1], () => db.query("select id from public.notifications"))).rows).toHaveLength(0);
    expect((await asUser(db, a.manager, () => db.query("select id from public.notifications"))).rows).toHaveLength(0);
    await asUser(db, a.employees[0], () => db.query("update public.notifications set is_read = true"));
    const n = (await db.query<{ read_at: string | null }>("select read_at from public.notifications")).rows[0];
    expect(n.read_at).not.toBeNull();
  });

  it("audit logs: managers of the org only", async () => {
    expect((await asUser(db, a.employees[0], () => db.query("select id from public.audit_logs"))).rows).toHaveLength(0);
    const mgrRows = await asUser(db, a.manager, () => db.query<{ organization_id: string }>("select organization_id from public.audit_logs"));
    expect(mgrRows.rows.length).toBeGreaterThan(0);
    expect(mgrRows.rows.every((r) => r.organization_id === a.org)).toBe(true);
  });
});
