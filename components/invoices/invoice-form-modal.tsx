"use client";
// Figma 1:1522 «صورت‌حساب جدید»; edit mode reuses the same form.
import { useEffect, useId, useState, type FormEvent } from "react";
import { Repeat } from "lucide-react";
import { Alert, Button, LoadingState } from "@/components/ui/primitives";
import { DateField, FieldShell, Modal, Segmented, SelectField, TextAreaField, TextField, Toggle, TomanField } from "@/components/ui/controls";
import { api, ApiError, fieldError } from "@/lib/client-api";
import type { InvoiceDetail } from "@/lib/services/invoices";

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function InvoiceFormModal({ invoiceId, onClose, onSaved }: { invoiceId?: string; onClose: () => void; onSaved: () => void }) {
  const listId = useId();
  const [title, setTitle] = useState("");
  const [supplier, setSupplier] = useState("");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState(todayIso());
  const [type, setType] = useState<"one_off" | "recurring">("one_off");
  const [recurrence, setRecurrence] = useState<"monthly" | "weekly">("monthly");
  const [endDate, setEndDate] = useState("");
  const [reminder, setReminder] = useState(true);
  const [description, setDescription] = useState("");
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [initial, setInitial] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(!!invoiceId);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api<{ items: string[] }>("/invoices/suppliers").then((r) => setSuppliers(r.items)).catch(() => undefined);
    if (!invoiceId) return;
    api<InvoiceDetail>(`/invoices/${invoiceId}`)
      .then((d) => {
        setInitial(d);
        setTitle(d.title);
        setSupplier(d.supplier_name);
        setAmount(d.amount_toman.split(".")[0]);
        setDue(d.due_date);
        setType(d.series_id ? "recurring" : "one_off");
        setReminder(d.reminder_enabled);
        setDescription(d.description);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [invoiceId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (invoiceId && initial) {
        const patch: Record<string, unknown> = {};
        if (title !== initial.title) patch.title = title;
        if (supplier !== initial.supplier_name) patch.supplier_name = supplier;
        if (amount !== initial.amount_toman.split(".")[0]) patch.amount_toman = amount;
        if (due !== initial.due_date) patch.due_date = due;
        if (reminder !== initial.reminder_enabled) patch.reminder_enabled = reminder;
        if (description !== initial.description) patch.description = description;
        if (Object.keys(patch).length) await api(`/invoices/${invoiceId}`, { method: "PATCH", body: patch });
      } else {
        await api("/invoices", {
          body: { title, supplier_name: supplier, amount_toman: amount, due_date: due, payment_type: type, recurrence_type: recurrence, end_date: endDate || null, reminder_enabled: reminder, description },
        });
      }
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={invoiceId ? "ویرایش صورت‌حساب" : "صورت‌حساب جدید"}
      subtitle={invoiceId ? initial?.title : "مشخصات پرداخت را وارد کنید."}
      footer={
        <>
          <Button type="submit" form="invoice-form" disabled={pending || loading}>
            ذخیره صورت‌حساب
          </Button>
          <Button variant="secondary" onClick={onClose}>
            انصراف
          </Button>
        </>
      }
    >
      {loading ? (
        <LoadingState />
      ) : (
        <form id="invoice-form" onSubmit={submit} className="flex flex-col gap-3">
          {error ? <Alert title={error instanceof ApiError ? error.messageFa : "ذخیره انجام نشد."} /> : null}
          <TextField label="عنوان صورت‌حساب" required placeholder="عنوان را وارد کنید" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} error={fieldError(error, "title")} />
          <TextField label="دریافت‌کننده" required placeholder="نام شخص یا شرکت" list={listId} value={supplier} onChange={(e) => setSupplier(e.target.value)} maxLength={200} error={fieldError(error, "supplier_name")} />
          <datalist id={listId}>
            {suppliers.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <TomanField label="مبلغ" required value={amount} onChange={setAmount} error={fieldError(error, "amount_toman")} />
          <DateField label="تاریخ سررسید" required value={due} onChange={setDue} error={fieldError(error, "due_date")} />
          {!invoiceId && (
            <>
              <div className="flex flex-col gap-2">
                <p className="text-xs font-bold">نوع پرداخت</p>
                <Segmented value={type} onChange={setType} options={[{ value: "one_off", label: "یک‌باره" }, { value: "recurring", label: "دوره‌ای" }]} className="self-start" />
              </div>
              {type === "recurring" && (
                <div className="grid grid-cols-2 gap-2.5">
                  <SelectField label="تکرار" options={[{ value: "monthly", label: "ماهانه" }, { value: "weekly", label: "هفتگی" }]} value={recurrence} onChange={(e) => setRecurrence(e.target.value as "monthly" | "weekly")} />
                  <DateField label="پایان دوره" placeholder="بدون پایان" value={endDate} onChange={setEndDate} error={fieldError(error, "end_date")} />
                </div>
              )}
            </>
          )}
          {invoiceId && initial?.series_id && (
            <FieldShell label="نوع پرداخت" icon={<Repeat size={16} />}>
              <span className="text-xs">دوره‌ای — تغییر مبلغ فقط همین صورت‌حساب را عوض می‌کند.</span>
            </FieldShell>
          )}
          <Toggle label="یادآوری پیش از موعد" description="سه روز قبل از سررسید" checked={reminder} onChange={setReminder} />
          <TextAreaField label="توضیحات" placeholder="شرح و جزئیات صورت‌حساب" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </form>
      )}
    </Modal>
  );
}
