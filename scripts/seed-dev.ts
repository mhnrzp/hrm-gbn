// DEVELOPMENT ONLY: fictional Persian sample team, tasks, leave, availability, meetings and invoices
// (names mirror the Figma mock-ups). Data is created through the real RPCs as a dev manager.
// Usage: SEED_PASSWORD=<dev password> pnpm seed --org gbn
import { config } from "dotenv";
import { parseArgs } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const { values } = parseArgs({ options: { org: { type: "string" }, yes: { type: "boolean", default: false } } });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secret = process.env.SUPABASE_SECRET_KEY!;
const password = process.env.SEED_PASSWORD;
const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";

if (!values.org || !password || password.length < 10) {
  console.error("Usage: SEED_PASSWORD=<at least 10 chars> pnpm seed --org <slug>");
  process.exit(1);
}
if (!site.includes("localhost") && !values.yes) {
  console.error("Refusing to seed: NEXT_PUBLIC_SITE_URL is not localhost. Pass --yes only for a dedicated dev/staging project.");
  process.exit(1);
}

const admin = createClient(url, secret, { auth: { persistSession: false } });

const PEOPLE = [
  { key: "ali", name: "علی رضایی", title: "مدیر مجموعه", role: "manager", mode: "office" },
  { key: "sara", name: "سارا محمدی", title: "طراح محصول", role: "employee", mode: "office" },
  { key: "mina", name: "مینا کریمی", title: "کارشناس پشتیبانی", role: "employee", mode: "remote" },
  { key: "hossein", name: "حسین نادری", title: "توسعه‌دهنده", role: "employee", mode: "office" },
  { key: "narges", name: "نرگس احمدی", title: "کارشناس محتوا", role: "employee", mode: "office" },
  { key: "reza", name: "رضا موسوی", title: "کارشناس مالی", role: "employee", mode: "office" },
] as const;

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};
const at = (offset: number, hhmm: string) => `${day(offset)}T${hhmm}:00+03:30`;

async function must<T>(p: PromiseLike<{ data: T; error: unknown }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${JSON.stringify(error)}`);
  return data;
}

async function main() {
  const org = await must(admin.from("organizations").select("id, name").eq("slug", values.org!).maybeSingle(), "find org");
  if (!org) throw new Error(`organisation "${values.org}" not found — run pnpm bootstrap first`);
  console.log(`Seeding ${org.name} (${org.id})`);

  const ids: Record<string, string> = {};
  for (const p of PEOPLE) {
    const email = `${p.key}@example.test`;
    const existing = await must(admin.from("profile_private").select("user_id").eq("email", email).maybeSingle(), "lookup");
    let userId = existing?.user_id as string | undefined;
    if (!userId) {
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: p.name } });
      if (created.error || !created.data.user) throw created.error;
      userId = created.data.user.id;
    }
    ids[p.key] = userId;
    await admin.from("profiles").update({ full_name: p.name }).eq("id", userId);
    await admin.from("profile_private").update({ phone: `0912${String(Math.floor(1000000 + Math.random() * 8999999))}` }).eq("user_id", userId);
    await must(
      admin.from("organization_memberships").upsert(
        { organization_id: org.id, user_id: userId, role: p.role, job_title: p.title, status: "active", work_mode: p.mode, joined_at: day(-400) },
        { onConflict: "organization_id,user_id" },
      ),
      "membership",
    );
    await admin.from("member_preferences").upsert({ organization_id: org.id, user_id: userId }, { onConflict: "organization_id,user_id" });
  }

  // Act as the dev manager so every business rule, audit row and notification runs for real.
  const asAli: SupabaseClient = createClient(url, anonKey, { auth: { persistSession: false } });
  if ((await asAli.auth.signInWithPassword({ email: "ali@example.test", password: password! })).error) throw new Error("sign in as ali failed");
  const asMina: SupabaseClient = createClient(url, anonKey, { auth: { persistSession: false } });
  if ((await asMina.auth.signInWithPassword({ email: "mina@example.test", password: password! })).error) throw new Error("sign in as mina failed");

  const types = await must(admin.from("leave_types").select("id, code").eq("organization_id", org.id), "leave types");
  const annual = (types ?? []).find((t) => t.code === "annual")!.id;

  const tasks = [
    { title: "طراحی صفحه لندینگ", priority: "important", who: "sara", start: 0, due: 2, description: "طراحی نسخه دسکتاپ و موبایل صفحه معرفی محصول و تحویل فایل نهایی." },
    { title: "آماده‌سازی گزارش ماهانه", priority: "urgent", who: "ali", due: -2, recurrence: "monthly" },
    { title: "بررسی نظرات کاربران", priority: "normal", who: "mina", due: 0, recurrence: "weekly" },
    { title: "به‌روزرسانی نسخه جدید", priority: "urgent", who: "hossein", start: 1, due: 3 },
    { title: "بازبینی قرارداد تأمین‌کننده", priority: "important", who: "reza", due: 1 },
    { title: "تدوین محتوای خبرنامه", priority: "normal", who: "narges", due: 3, recurrence: "monthly" },
    { title: "آزمون فرایند ثبت‌نام", priority: "important", who: "hossein", due: 4 },
    { title: "تهیه راهنمای شروع همکاری", priority: "normal", who: "sara", due: -3 },
  ];
  for (const t of tasks) {
    const res = await must(
      asAli.rpc("create_task", {
        p: {
          organization_id: org.id,
          title: t.title,
          description: t.description ?? "",
          priority: t.priority,
          assignee_ids: [ids[t.who]],
          due_date: day(t.due),
          due_time: "17:00",
          start_date: t.start !== undefined ? day(t.start) : null,
          start_time: t.start !== undefined ? "09:00" : null,
          recurrence_type: t.recurrence ?? "none",
        },
      }),
      `task ${t.title}`,
    );
    if (t.title === "تهیه راهنمای شروع همکاری") {
      const asSara = createClient(url, anonKey, { auth: { persistSession: false } });
      await asSara.auth.signInWithPassword({ email: "sara@example.test", password: password! });
      await asSara.rpc("complete_occurrence", { p_occurrence: (res as { occurrence_id: string }).occurrence_id, p_note: "فایل‌های دسکتاپ و موبایل تحویل داده شد." });
    }
  }

  await asMina.rpc("submit_leave", { p: { organization_id: org.id, leave_type_id: annual, start_date: day(3), end_date: day(4), reason: "رسیدگی به امور شخصی و خانوادگی" } });
  await asAli.rpc("submit_leave", { p: { organization_id: org.id, employee_id: ids.narges, leave_type_id: annual, start_date: day(0), end_date: day(0), reason: "امور شخصی", approve_now: true } });

  for (const who of ["ali", "hossein", "narges", "reza"]) {
    await asAli.rpc("save_availability", { p: { organization_id: org.id, employee_id: ids[who], start_date: day(3), start_time: "13:00", end_time: "16:00", recurrence_type: "weekly", note: "زمان مناسب برای هماهنگی و جلسه با تیم" } });
  }
  await asAli.rpc("save_event", {
    p: { organization_id: org.id, title: "جلسه بازبینی طراحی", location: "اتاق جلسه مجموعه", description: "مرور نسخه دسکتاپ و جمع‌بندی بازخوردها.", start_at: at(1, "10:00"), end_at: at(1, "11:00"), attendee_ids: [ids.sara], force: true },
  });

  const invoices = [
    { title: "تمدید سرویس میزبانی", supplier: "شرکت ابر آریا", toman: 12_500_000, due: -1, recurring: true },
    { title: "حق‌الزحمه طراحی", supplier: "سارا محمدی", toman: 8_000_000, due: 2 },
    { title: "اشتراک نرم‌افزار", supplier: "شرکت داده‌پرداز", toman: 4_500_000, due: 10, recurring: true },
    { title: "اجاره دفتر", supplier: "رضا رحیمی", toman: 15_500_000, due: -3, recurring: true, pay: true },
    { title: "خدمات بازاریابی", supplier: "شرکت ایده نو", toman: 12_500_000, due: -5, pay: true },
  ];
  for (const inv of invoices) {
    const irr = String(BigInt(inv.toman) * BigInt(10));
    const res = inv.recurring
      ? await must(asAli.rpc("create_invoice_series", { p: { title: inv.title, supplier_name: inv.supplier, amount_irr: irr, recurrence_type: "monthly", first_due_date: day(inv.due) } }), inv.title)
      : await must(asAli.rpc("create_invoice", { p: { title: inv.title, supplier_name: inv.supplier, amount_irr: irr, due_date: day(inv.due) } }), inv.title);
    if (inv.pay) {
      await must(
        asAli.rpc("mark_invoice_paid", { p_id: (res as { invoice_id: string }).invoice_id, p: { amount_irr: irr, method: "bank_transfer", transaction_reference: String(87432165 + Math.floor(Math.random() * 1000)), idempotency_key: `seed-${inv.title}` } }),
        `pay ${inv.title}`,
      );
    }
  }

  console.log("Done. Dev accounts (password = SEED_PASSWORD):");
  for (const p of PEOPLE) console.log(`  ${p.key}@example.test  ${p.role === "manager" ? "(manager)" : ""}`);
}

main().catch((e) => {
  console.error("Seed failed:", e.message ?? e);
  process.exit(1);
});
