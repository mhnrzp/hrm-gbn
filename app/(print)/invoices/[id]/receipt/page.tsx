import { notFound } from "next/navigation";
import { requirePageMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { invoiceDetail } from "@/lib/services/invoices";
import { AppError } from "@/lib/errors";
import { faDigits, formatDate, formatTime, formatToman } from "@/lib/format";
import { PAYMENT_METHOD } from "@/lib/labels";
import { PrintButton } from "./print-button";

export const metadata = { title: "رسید پرداخت | GBN HRM" };

// «دریافت رسید»: print-styled page; the browser's print dialog saves it as PDF.
export default async function ReceiptPage({ params }: PageProps<"/invoices/[id]/receipt">) {
  const member = await requirePageMember({ manager: true });
  const { id } = await params;
  const db = await createClient();
  const data = await invoiceDetail(db, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const payment = data.payments.find((p) => !p.voided_at);
  if (!payment) notFound();
  const tz = member.org.timezone;

  const rows: [string, string][] = [
    ["شماره صورت‌حساب", faDigits(data.invoice_reference)],
    ["عنوان", data.title],
    ["دریافت‌کننده", data.supplier_name],
    ["مبلغ", formatToman(data.amount_irr)],
    ["تاریخ سررسید", formatDate(data.due_date, "UTC")],
    ["تاریخ پرداخت", `${formatDate(payment.paid_at, tz)}، ${formatTime(payment.paid_at, tz)}`],
    ["روش پرداخت", PAYMENT_METHOD[payment.method] ?? payment.method],
    ["شماره پیگیری", payment.transaction_reference ? faDigits(payment.transaction_reference) : "—"],
    ["ثبت‌کننده", payment.confirmed_by_name],
  ];

  return (
    <article className="mx-auto flex max-w-[640px] flex-col gap-6 rounded-lg border border-line p-8 print:border-0">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">رسید ثبت پرداخت</h1>
          <p className="text-xs text-muted">{data.organization.name}</p>
          {data.organization.address && <p className="text-[11px] text-muted">{data.organization.address}</p>}
        </div>
        <p className="text-[22px] font-bold text-brand" dir="ltr">
          GBN HRM
        </p>
      </header>
      <dl className="flex flex-col divide-y divide-line text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between py-3">
            <dt className="text-muted">{k}</dt>
            <dd className="font-bold">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[11px] text-muted">این رسید تأیید ثبت پرداخت در سامانه است و به‌معنای انتقال وجه توسط سامانه نیست.</p>
      <PrintButton />
    </article>
  );
}
