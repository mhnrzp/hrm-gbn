import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, createOrg, destroyOrg, liveConfigured, type LiveOrg } from "./live";

const day = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

describe.skipIf(!liveConfigured)("live Supabase: auth, RLS and concurrency", () => {
  let a: LiveOrg;
  let b: LiveOrg;

  beforeAll(async () => {
    a = await createOrg("a");
    b = await createOrg("b");
  });
  afterAll(async () => {
    if (a) await destroyOrg(a);
    if (b) await destroyOrg(b);
  });

  it("AUTH-01: anonymous requests get no data", async () => {
    const { data, error } = await anon().from("organizations").select("id");
    expect(error?.code === "42501" || (data ?? []).length === 0).toBe(true);
  });

  it("AUTH-02/06: employees cannot read invoices; other orgs cannot read tasks", async () => {
    const [e1] = a.employees;
    const inv = await e1.client.rpc("invoice_list");
    expect(inv.error?.message).toBe("FORBIDDEN");
    const direct = await e1.client.from("invoices").select("id");
    expect(direct.error?.code).toBe("42501");

    const t = await a.manager.client.rpc("create_task", { p: { organization_id: a.id, title: "secret", due_date: day(2), assignee_ids: [e1.id] } });
    expect(t.error).toBeNull();
    const cross = await b.manager.client.from("tasks").select("id").eq("id", t.data.task_id);
    expect(cross.data).toEqual([]);
  });

  it("AUTH-05: role escalation through a profile write is impossible", async () => {
    const [e1] = a.employees;
    const res = await e1.client.from("organization_memberships").update({ role: "manager" }).eq("user_id", e1.id);
    expect(res.error?.code).toBe("42501");
  });

  it("TASK-02: concurrent team-pool claims — exactly one wins", async () => {
    const t = await a.manager.client.rpc("create_task", { p: { organization_id: a.id, title: "pool", due_date: day(1), assignment_mode: "team_pool" } });
    const occ = t.data.occurrence_id;
    const results = await Promise.all(a.employees.map((e) => e.client.rpc("claim_occurrence", { p_occurrence: occ })));
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.filter((r) => r.error?.message === "TASK_ALREADY_CLAIMED")).toHaveLength(1);
  });

  it("LEAVE-04: two managers deciding at once — one transition wins", async () => {
    const [e1] = a.employees;
    const types = await a.manager.client.from("leave_types").select("id, code");
    const annual = types.data!.find((t) => t.code === "annual")!.id;
    const req = await e1.client.rpc("submit_leave", { p: { organization_id: a.id, leave_type_id: annual, start_date: day(30), end_date: day(30), reason: "it" } });
    const [r1, r2] = await Promise.all([
      a.manager.client.rpc("review_leave", { p_id: req.data.leave_request_id, p_decision: "approve" }),
      a.manager2.client.rpc("review_leave", { p_id: req.data.leave_request_id, p_decision: "reject", p_comment: "no" }),
    ]);
    expect([r1, r2].filter((r) => !r.error)).toHaveLength(1);
    expect([r1, r2].filter((r) => r.error?.message === "LEAVE_ALREADY_REVIEWED")).toHaveLength(1);
  });

  it("INV-04: double click and parallel retries record one payment", async () => {
    const inv = await a.manager.client.rpc("create_invoice", { p: { title: "it", supplier_name: "s", amount_irr: "125000000", due_date: day(5) } });
    const id = inv.data.invoice_id;
    const pay = (key: string) => a.manager.client.rpc("mark_invoice_paid", { p_id: id, p: { amount_irr: "125000000", idempotency_key: key } });
    const results = await Promise.all([pay("k1"), pay("k1"), pay("k2"), pay("k2")]);
    expect(results.filter((r) => !r.error).length).toBeGreaterThanOrEqual(1);
    const detail = await a.manager.client.rpc("invoice_detail", { p_id: id });
    expect((detail.data.payments as unknown[]).length).toBe(1);
    expect(detail.data.payment_state).toBe("paid");
  });

  it("LEAVE-05: co-workers see approved timing without the private reason", async () => {
    const [e1, e2] = a.employees;
    const types = await a.manager.client.from("leave_types").select("id, code");
    const annual = types.data!.find((t) => t.code === "annual")!.id;
    await a.manager.client.rpc("submit_leave", { p: { organization_id: a.id, employee_id: e1.id, leave_type_id: annual, start_date: day(40), end_date: day(40), reason: "very private reason", approve_now: true } });
    const feed = await e2.client.rpc("calendar_feed", { p_from: `${day(39)}T00:00:00Z`, p_to: `${day(42)}T00:00:00Z` });
    expect(feed.error).toBeNull();
    expect(JSON.stringify(feed.data)).not.toContain("very private reason");
    expect((feed.data as { type: string }[]).some((i) => i.type === "leave")).toBe(true);
  });
});
