"use client";
// Figma 1:1522: «جزئیات صورت‌حساب», «تأیید پرداخت», «پرداخت با موفقیت ثبت شد».
import { useEffect, useMemo, useState } from "react";
import { Check, CircleCheck, CreditCard, Download, TriangleAlert } from "lucide-react";
import { Alert, Badge, Button, ButtonLink, LoadingState } from "@/components/ui/primitives";
import { DateField, ErrorState, Modal, SelectField, TextAreaField, TextField } from "@/components/ui/controls";
import { api, ApiError } from "@/lib/client-api";
import { faDigits, faNumber, formatDate, formatStamp, formatTime, formatToman, jalaliParts, localIsoDate } from "@/lib/format";
import { INVOICE_STATE, PAYMENT_METHOD } from "@/lib/labels";
import type { InvoiceDetail } from "@/lib/services/invoices";

type Step = "detail" | "pay" | "paid" | "void";

export function InvoiceDetailModal({ id, startWithPayment, timezone, onClose, onChanged, onEdit }: { id: string; startWithPayment?: boolean; timezone: string; onClose: () => void; onChanged: () => void; onEdit: () => void }) {
  const [data, setData] = useState<InvoiceDetail | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [step, setStep] = useState<Step>(startWithPayment ? "pay" : "detail");
  const [paidDate, setPaidDate] = useState(localIsoDate(new Date(), timezone));
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // One key per opened payment form: double clicks and retries record a single payment.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const load = () =>
    api<InvoiceDetail>(`/invoices/${id}`)
      .then((d) => {
        setData(d);
        setLoadError(false);
      })
      .catch(() => setLoadError(true));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function run(action: () => Promise<unknown>, next: Step) {
    setPending(true);
    setError(null);
    try {
      await action();
      await load();
      setStep(next);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.messageFa : "ثبت انجام نشد.");
    } finally {
      setPending(false);
    }
  }

  if (loadError) return <Modal open onClose={onClose} title="جزئیات صورت‌حساب"><ErrorState /></Modal>;
  if (!data) return <Modal open onClose={onClose} title="جزئیات صورت‌حساب"><LoadingState /></Modal>;

  const state = INVOICE_STATE[data.display_state];
  const activePayment = data.payments.find((p) => !p.voided_at);
  const amount = <p className="text-[22px] font-bold">{formatToman(data.amount_irr)}</p>;

  if (step === "pay") {
    return (
      <Modal
        open
        onClose={onClose}
        title="تأیید پرداخت"
        subtitle="پیش از ثبت، اطلاعات را بررسی کنید."
        footer={
          <>
            <Button icon={Check} disabled={pending} onClick={() => run(() => api(`/invoices/${id}/mark-paid`, { body: { amount_toman: data.amount_toman.split(".")[0], paid_date: paidDate, method, transaction_reference: reference || undefined, idempotency_key: idempotencyKey } }), "paid")}>
              تأیید و ثبت پرداخت
            </Button>
            <Button variant="secondary" onClick={() => (startWithPayment ? onClose() : setStep("detail"))}>
              انصراف
            </Button>
          </>
        }
      >
        {error && <Alert title={error} />}
        {amount}
        <p className="text-xs">
          {data.title} • {data.supplier_name}
        </p>
        <DateField label="تاریخ پرداخت" value={paidDate} onChange={setPaidDate} />
        <SelectField label="روش پرداخت" options={Object.entries(PAYMENT_METHOD).map(([value, label]) => ({ value, label }))} value={method} onChange={(e) => setMethod(e.target.value)} />
        <TextField label="شماره پیگیری" dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
        <Alert tone="blue" icon={TriangleAlert} title="ثبت پرداخت به‌معنای انتقال وجه نیست.">
          پس از پرداخت واقعی، این تأیید را برای به‌روزرسانی وضعیت ثبت کنید.
        </Alert>
      </Modal>
    );
  }

  if (step === "paid" && activePayment) {
    return (
      <Modal
        open
        onClose={onClose}
        title="پرداخت با موفقیت ثبت شد"
        footer={
          <ButtonLink href={`/invoices/${id}/receipt`} target="_blank" icon={Download}>
            دریافت رسید
          </ButtonLink>
        }
      >
        <Alert tone="green" icon={CircleCheck} title="صورت‌حساب پرداخت‌شده است">
          مبلغ {formatToman(data.amount_irr)} برای {data.supplier_name} ثبت شد.
        </Alert>
        <Badge tone="green" className="self-start">پرداخت‌شده</Badge>
        <p className="text-xs">
          {formatDate(activePayment.paid_at, timezone)}، {formatTime(activePayment.created_at, timezone)} • ثبت‌کننده: {activePayment.confirmed_by_name}
        </p>
        {activePayment.transaction_reference && <p className="text-xs">شماره پیگیری: {faDigits(activePayment.transaction_reference)}</p>}
      </Modal>
    );
  }

  if (step === "void") {
    return (
      <Modal
        open
        onClose={onClose}
        title="اصلاح پرداخت"
        subtitle="ابطال ثبت پرداخت با ذکر دلیل"
        footer={
          <>
            <Button variant="danger" disabled={pending || !voidReason.trim()} onClick={() => run(() => api(`/invoices/${id}/void-payment`, { body: { reason: voidReason } }), "detail")}>
              ابطال پرداخت
            </Button>
            <Button variant="secondary" onClick={() => setStep("detail")}>
              انصراف
            </Button>
          </>
        }
      >
        {error && <Alert title={error} />}
        <Alert tone="amber" title="این کار در گزارش فعالیت ثبت می‌شود">صورت‌حساب دوباره پرداخت‌نشده می‌شود؛ سابقه پرداخت حذف نمی‌شود.</Alert>
        <TextAreaField label="دلیل اصلاح" required value={voidReason} onChange={(e) => setVoidReason(e.target.value)} maxLength={1000} />
      </Modal>
    );
  }

  const dueDay = jalaliParts(data.due_date, "UTC").day;
  return (
    <Modal
      open
      onClose={onClose}
      title="جزئیات صورت‌حساب"
      footer={
        <>
          {data.payment_state === "unpaid" && (
            <Button icon={CreditCard} onClick={() => setStep("pay")}>
              ثبت پرداخت
            </Button>
          )}
          {data.payment_state === "unpaid" && (
            <Button variant="secondary" onClick={onEdit}>
              ویرایش
            </Button>
          )}
          {data.payment_state === "paid" && (
            <>
              <ButtonLink variant="secondary" href={`/invoices/${id}/receipt`} target="_blank" icon={Download}>
                دریافت رسید
              </ButtonLink>
              <Button variant="ghost" className="text-danger" onClick={() => setStep("void")}>
                اصلاح پرداخت
              </Button>
            </>
          )}
        </>
      }
    >
      {error && <Alert title={error} />}
      <Badge tone={state.tone} className="self-start">{state.label}</Badge>
      {amount}
      <h3 className="text-[15px] font-bold">{data.title}</h3>
      <dl className="flex flex-col gap-3 border-t border-line pt-4 text-xs">
        {[
          ["دریافت‌کننده", data.supplier_name],
          ["تاریخ سررسید", formatDate(data.due_date, "UTC")],
          ["نوع پرداخت", data.series ? `${data.series.recurrence_type === "weekly" ? "هفتگی" : "ماهانه"} • روز ${faDigits(dueDay)} هر ${data.series.recurrence_type === "weekly" ? "هفته" : "ماه"}` : "یک‌باره"],
          ["شماره صورت‌حساب", faDigits(data.invoice_reference)],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3">
            <dt className="text-muted">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {data.description && <p className="text-[11px] text-muted">{data.description}</p>}
      {data.display_state === "overdue" && (
        <Alert icon={TriangleAlert} title={`${faNumber(data.days_overdue)} روز از سررسید گذشته است`}>
          پس از پرداخت، وضعیت صورت‌حساب را به‌روزرسانی کنید.
        </Alert>
      )}
      {data.payments.some((p) => p.voided_at) && (
        <div className="flex flex-col gap-1 text-[11px] text-muted">
          {data.payments.filter((p) => p.voided_at).map((p) => (
            <p key={p.id}>
              پرداخت ابطال‌شده ({formatDate(p.paid_at, timezone)}): {p.void_reason}
            </p>
          ))}
        </div>
      )}
      <p className="text-[10px] text-muted">
        ثبت توسط {data.created_by_name} • {formatStamp(data.created_at, timezone)}
      </p>
    </Modal>
  );
}
