import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createDb, expectCode, seedOrg, type Db } from "./harness";
import { irrToTomanString, tomanToIrr } from "@/lib/money";

let db: Db;
let a: Awaited<ReturnType<typeof seedOrg>>;
let b: Awaited<ReturnType<typeof seedOrg>>;
let sara: string;

const day = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
async function rpc<T>(user: string, sql: string, params: unknown[] = []) {
  return (await asUser(db, user, () => db.query<{ r: T }>(sql, params))).rows[0].r;
}

beforeAll(async () => {
  db = await createDb();
  a = await seedOrg(db, { slug: "inv-a", employees: ["Sara"] });
  b = await seedOrg(db, { slug: "inv-b" });
  sara = a.employees[0];
});

describe("invoices", () => {
  it("INV-01: one-off invoice round-trips toman ↔ IRR exactly and gets a Jalali reference", async () => {
    const irr = tomanToIrr("12500000").toString();
    const res = await rpc<{ invoice_id: string; invoice_reference: string }>(a.manager, "select public.create_invoice($1) as r", [
      { title: "تمدید سرویس میزبانی", supplier_name: "شرکت ابر آریا", amount_irr: irr, due_date: day(5) },
    ]);
    expect(res.invoice_reference).toMatch(/^14\d\d\/001$/);
    const detail = await rpc<{ amount_irr: string; display_state: string }>(a.manager, "select public.invoice_detail($1) as r", [res.invoice_id]);
    expect(irrToTomanString(detail.amount_irr)).toBe("12500000");
    expect(detail.display_state).toBe("unpaid");
  });

  it("AUTH-02: employees have no access to invoice data by any path", async () => {
    await expect(asUser(db, sara, () => db.query("select * from public.invoices"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, sara, () => db.query("select * from public.payment_records"))).rejects.toThrow(/permission denied/);
    await expectCode(asUser(db, sara, () => db.query("select * from public.invoice_list()")), "FORBIDDEN");
    await expectCode(asUser(db, sara, () => db.query("select public.invoice_summary()")), "FORBIDDEN");
    await expect(asUser(db, a.manager, () => db.query("select * from public.invoices"))).rejects.toThrow(/permission denied/);
  });

  it("INV-02: a monthly series generates independent invoices on distinct Jalali-month dates", async () => {
    const res = await rpc<{ series_id: string; generated: number }>(a.manager, "select public.create_invoice_series($1) as r", [
      { title: "اجاره دفتر", supplier_name: "رضا رحیمی", amount_irr: "155000000", recurrence_type: "monthly", first_due_date: day(1) },
    ]);
    expect(res.generated).toBeGreaterThanOrEqual(3);
    const rows = (await db.query<{ due_date: string; invoice_reference: string }>("select due_date::text, invoice_reference from public.invoices where series_id = $1 order by due_date", [res.series_id])).rows;
    expect(new Set(rows.map((r) => r.due_date)).size).toBe(rows.length);
    expect(new Set(rows.map((r) => r.invoice_reference)).size).toBe(rows.length);
    // Generator re-run is idempotent.
    await db.query("select app.generate_invoice_occurrences()");
    expect((await db.query("select id from public.invoices where series_id = $1", [res.series_id])).rows).toHaveLength(rows.length);
  });

  it("INV-03 + INV-04: paying one recurring invoice leaves the next unpaid; retries never double-pay", async () => {
    const res = await rpc<{ series_id: string }>(a.manager, "select public.create_invoice_series($1) as r", [
      { title: "میزبانی ماهانه", supplier_name: "ابر آریا", amount_irr: "45000000", recurrence_type: "monthly", first_due_date: day(2) },
    ]);
    const [first, second] = (await db.query<{ id: string }>("select id from public.invoices where series_id = $1 order by due_date", [res.series_id])).rows;
    const pay = { amount_irr: "45000000", method: "bank_transfer", transaction_reference: "87432165", idempotency_key: "click-1" };
    const p1 = await rpc<{ payment_id: string; idempotent_replay: boolean }>(a.manager, "select public.mark_invoice_paid($1, $2) as r", [first.id, pay]);
    const p2 = await rpc<{ payment_id: string; idempotent_replay: boolean }>(a.manager, "select public.mark_invoice_paid($1, $2) as r", [first.id, pay]);
    expect(p2).toEqual({ ...p2, payment_id: p1.payment_id, idempotent_replay: true });
    await expectCode(rpc(a.manager, "select public.mark_invoice_paid($1, $2) as r", [first.id, { ...pay, idempotency_key: "click-2" }]), "INVOICE_ALREADY_PAID");
    expect((await db.query("select id from public.payment_records where invoice_id = $1", [first.id])).rows).toHaveLength(1);
    const states = (await db.query<{ id: string; payment_state: string }>("select id, payment_state from public.invoices where id in ($1, $2)", [first.id, second.id])).rows;
    expect(Object.fromEntries(states.map((s) => [s.id, s.payment_state]))).toEqual({ [first.id]: "paid", [second.id]: "unpaid" });
  });

  it("partial / mismatched amounts are refused; paid invoices are immutable; void restores unpaid with audit", async () => {
    const { invoice_id: id } = await rpc<{ invoice_id: string }>(a.manager, "select public.create_invoice($1) as r", [
      { title: "حق‌الزحمه طراحی", supplier_name: "سارا محمدی", amount_irr: "80000000", due_date: day(3) },
    ]);
    await expectCode(rpc(a.manager, "select public.mark_invoice_paid($1, $2) as r", [id, { amount_irr: "1" }]), "AMOUNT_MISMATCH");
    await rpc(a.manager, "select public.mark_invoice_paid($1, $2) as r", [id, { amount_irr: "80000000" }]);
    await expectCode(rpc(a.manager, "select public.update_invoice($1, $2) as r", [id, { amount_irr: "1" }]), "INVOICE_ALREADY_PAID");
    await expectCode(rpc(a.manager, "select public.void_payment($1, '') as r", [id]), "VALIDATION_FAILED");
    await rpc(a.manager, "select public.void_payment($1, 'ثبت اشتباه') as r", [id]);
    const inv = (await db.query<{ payment_state: string }>("select payment_state from public.invoices where id = $1", [id])).rows[0];
    expect(inv.payment_state).toBe("unpaid");
    const audit = (await db.query<{ changed_fields: Record<string, unknown> }>("select changed_fields from public.audit_logs where entity_type = 'payment_records' and action = 'payment_records.update'")).rows;
    expect(audit[0].changed_fields).toMatchObject({ void_reason: "ثبت اشتباه" });
    // A paid state can never exist without a settlement.
    await expect(db.query("update public.invoices set payment_state = 'paid', paid_at = now() where id = $1", [id])).rejects.toThrow(/settlement/);
  });

  it("INV-05: unpaid past-due invoice is derived overdue; summary aggregates as strings", async () => {
    await rpc(a.manager, "select public.create_invoice($1) as r", [{ title: "Late bill", supplier_name: "X", amount_irr: "1000", due_date: day(-2) }]);
    const list = await asUser(db, a.manager, () => db.query<{ title: string; display_state: string }>("select title, display_state from public.invoice_list(p_state => 'overdue')"));
    expect(list.rows.map((r) => r.title)).toContain("Late bill");
    const summary = await rpc<{ overdue_count: number; overdue_irr: string }>(a.manager, "select public.invoice_summary() as r");
    expect(summary.overdue_count).toBeGreaterThanOrEqual(1);
    expect(typeof summary.overdue_irr).toBe("string");
  });

  it("AUTH-06: another organisation's manager cannot read or pay these invoices", async () => {
    const { invoice_id: id } = await rpc<{ invoice_id: string }>(a.manager, "select public.create_invoice($1) as r", [{ title: "Private", supplier_name: "Y", amount_irr: "5", due_date: day(9) }]);
    await expectCode(rpc(b.manager, "select public.invoice_detail($1) as r", [id]), "NOT_FOUND");
    await expectCode(rpc(b.manager, "select public.mark_invoice_paid($1, $2) as r", [id, { amount_irr: "5" }]), "NOT_FOUND");
    const listB = await asUser(db, b.manager, () => db.query("select id from public.invoice_list()"));
    expect(listB.rows).toHaveLength(0);
  });
});
