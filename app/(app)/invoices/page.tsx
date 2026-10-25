import { requirePageMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { invoiceSummary, listInvoices } from "@/lib/services/invoices";
import { invoiceListSchema } from "@/lib/validation/invoices";
import { InvoicesView } from "@/components/invoices/invoices-view";

export const metadata = { title: "صورت‌حساب‌ها و پرداخت‌ها | GBN HRM" };

export default async function InvoicesPage({ searchParams }: PageProps<"/invoices">) {
  const member = await requirePageMember({ manager: true });
  const raw = await searchParams;
  const parsed = invoiceListSchema.safeParse(Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string")));
  const query = parsed.success ? parsed.data : invoiceListSchema.parse({});
  const db = await createClient();

  const [list, summary, overdue] = await Promise.all([
    listInvoices(db, query),
    invoiceSummary(db, query.from, query.to),
    listInvoices(db, { state: "overdue", limit: 5 }),
  ]);

  return <InvoicesView rows={list.rows} total={list.total} summary={summary} overdue={overdue.rows} overdueTotal={overdue.total} query={query} timezone={member.org.timezone} />;
}
