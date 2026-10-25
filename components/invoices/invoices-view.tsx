"use client";
// Figma: صورت‌حساب‌ها و پرداخت‌ها (1:2810), mobile (1:811), states (1:1522).
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Clock3, Download, Plus, Receipt, RotateCw, Search, TriangleAlert } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, PageTitle, StatCard, Table, Td, Th, cn } from "@/components/ui/primitives";
import { FilterMenu, Menu } from "@/components/ui/controls";
import { faDigits, faNumber, formatDate, formatDayMonth, formatToman, jalaliParts } from "@/lib/format";
import { jalaliMonth, shiftJalaliMonth } from "@/lib/calendar-dates";
import { INVOICE_STATE } from "@/lib/labels";
import type { InvoiceRow, InvoiceSummary } from "@/lib/services/invoices";
import type { InvoiceListQuery } from "@/lib/validation/invoices";
import { InvoiceFormModal } from "./invoice-form-modal";
import { InvoiceDetailModal } from "./invoice-detail-modal";

export function InvoicesView({ rows, total, summary, overdue, overdueTotal, query, timezone }: { rows: InvoiceRow[]; total: number; summary: InvoiceSummary; overdue: InvoiceRow[]; overdueTotal: number; query: InvoiceListQuery; timezone: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState(query.q ?? "");
  const [form, setForm] = useState<{ id?: string } | null>(null);
  const [detail, setDetail] = useState<{ id: string; pay?: boolean } | null>(null);

  function setParams(patch: Record<string, string | undefined>, resetPage = true) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (resetPage) next.delete("page");
    startTransition(() => router.replace(`?${next.toString()}`, { scroll: false }));
  }

  useEffect(() => {
    if ((query.q ?? "") === search) return;
    const t = setTimeout(() => setParams({ q: search.trim() || undefined }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const monthAnchor = query.from ?? null;
  const monthLabel = monthAnchor ? (() => { const p = jalaliParts(monthAnchor, "UTC"); return `${p.monthName} ${faDigits(p.year)}`; })() : "همه ماه‌ها";
  const setMonth = (iso: string | null) => {
    if (!iso) return setParams({ from: undefined, to: undefined });
    const m = jalaliMonth(iso);
    setParams({ from: m.first, to: m.last });
  };
  const exportHref = `/api/v1/invoices/export.csv?${new URLSearchParams(Object.entries({ state: query.state, from: query.from, to: query.to, q: query.q }).filter(([, v]) => v) as [string, string][]).toString()}`;

  const from = total === 0 ? 0 : (query.page - 1) * query.limit + 1;
  const to = Math.min(query.page * query.limit, total);
  const pages = Math.max(1, Math.ceil(total / query.limit));
  const firstOverdue = overdue[0];

  return (
    <>
      <PageTitle title="صورت‌حساب‌ها و پرداخت‌ها" subtitle="مدیریت تعهدات مالی و پرداخت‌های دوره‌ای مجموعه" actions={<Button icon={Plus} onClick={() => setForm({})}>صورت‌حساب جدید</Button>} />

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StatCard value={formatToman(summary.unpaid_irr, false)} label="مجموع پرداخت‌نشده" hint={`تومان • ${faNumber(summary.unpaid_count)} صورت‌حساب`} hintTone="blue" icon={Receipt} tone="blue" />
        <StatCard value={formatToman(summary.paid_irr, false)} label="پرداخت‌شده" hint={`تومان • ${faNumber(summary.paid_count)} صورت‌حساب`} hintTone="green" icon={CircleCheck} tone="green" />
        <StatCard value={formatToman(summary.due_soon_irr, false)} label="نزدیک به سررسید" hint={`تومان • تا ${faNumber(summary.lead_days)} روز آینده`} hintTone="amber" icon={Clock3} tone="amber" />
        <StatCard value={formatToman(summary.overdue_irr, false)} label="معوق" hint={`تومان • ${faNumber(summary.overdue_count)} صورت‌حساب`} hintTone="red" icon={CircleAlert} tone="red" />
      </div>

      {firstOverdue && (
        <Alert icon={TriangleAlert} title={`${faNumber(overdueTotal)} صورت‌حساب نیاز به رسیدگی دارد`}>
          {firstOverdue.title} به مبلغ {formatToman(firstOverdue.amount_irr)}، از {formatDayMonth(firstOverdue.due_date, "UTC")} سررسید گذشته است.{" "}
          <button type="button" className="font-bold text-brand" onClick={() => setDetail({ id: firstOverdue.id, pay: true })}>
            ثبت پرداخت
          </button>
        </Alert>
      )}

      <Card>
        <CardHeader title="فهرست صورت‌حساب‌ها" actions={<a href={exportHref} download><Button variant="secondary" icon={Download}>دریافت گزارش</Button></a>} />
        <div className="flex flex-col gap-3 px-[18px] pb-[18px] lg:flex-row lg:items-center lg:justify-between">
          <label className="flex h-[38px] w-full items-center gap-2 rounded-ctl border border-line bg-card px-3 focus-within:border-brand lg:w-[290px]">
            <Search size={16} className="text-muted" aria-hidden />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جستجو..." aria-label="جستجوی صورت‌حساب" className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted" />
          </label>
          <div className="flex flex-wrap gap-2.5">
            <Menu
              trigger={({ toggle }) => (
                <Button variant="secondary" icon={CalendarDays} onClick={toggle} className={cn(monthAnchor && "border-brand text-brand")}>
                  {monthLabel}
                </Button>
              )}
              items={[
                { key: "all", label: "همه ماه‌ها", selected: !monthAnchor, onSelect: () => setMonth(null) },
                ...[-2, -1, 0, 1, 2].map((offset) => {
                  const iso = shiftJalaliMonth(new Date().toISOString().slice(0, 10), offset);
                  const p = jalaliParts(iso, "UTC");
                  const first = jalaliMonth(iso).first;
                  return { key: first, label: `${p.monthName} ${faDigits(p.year)}`, selected: query.from === first, onSelect: () => setMonth(iso) };
                }),
              ]}
            />
            <FilterMenu label="همه پرداخت‌ها" allLabel="همه پرداخت‌ها" icon={ChevronDown} value={query.state} onChange={(v) => setParams({ state: v })}
              options={[{ value: "unpaid", label: "پرداخت‌نشده" }, { value: "due_soon", label: "نزدیک به سررسید" }, { value: "overdue", label: "سررسید گذشته" }, { value: "paid", label: "پرداخت‌شده" }, { value: "cancelled", label: "لغوشده" }]} />
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState message={query.state || query.q || query.from ? "صورت‌حسابی با این فیلترها پیدا نشد." : "هنوز صورت‌حسابی ثبت نشده است."} action={!query.state && !query.q && <Button icon={Plus} onClick={() => setForm({})}>صورت‌حساب جدید</Button>} />
        ) : (
          <>
            <div className="hidden lg:block">
              <Table>
                <thead>
                  <tr>
                    <Th>عنوان صورت‌حساب</Th>
                    <Th>دریافت‌کننده</Th>
                    <Th>مبلغ</Th>
                    <Th>تاریخ سررسید</Th>
                    <Th>نوع پرداخت</Th>
                    <Th>وضعیت</Th>
                    <Th>عملیات</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-app/60">
                      <Td>{r.title}</Td>
                      <Td>{r.supplier_name}</Td>
                      <Td>{formatToman(r.amount_irr)}</Td>
                      <Td>{formatDate(r.due_date, "UTC")}</Td>
                      <Td>{r.series_id ? <span className="inline-flex items-center gap-1"><RotateCw size={12} aria-hidden /> {r.recurrence_type === "weekly" ? "هفتگی" : "ماهانه"}</span> : "یک‌باره"}</Td>
                      <Td>
                        <Badge tone={INVOICE_STATE[r.display_state].tone}>{INVOICE_STATE[r.display_state].label}</Badge>
                      </Td>
                      <Td>
                        <button type="button" className="text-brand hover:underline" onClick={() => setDetail({ id: r.id })}>
                          جزئیات
                        </button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <div className="flex flex-col gap-3 px-[18px] lg:hidden">
              {rows.map((r) => (
                <button key={r.id} type="button" onClick={() => setDetail({ id: r.id })} className="flex flex-col gap-2 rounded-card border border-line p-4 text-right">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] font-bold">{r.title}</span>
                    <Badge tone={INVOICE_STATE[r.display_state].tone}>{INVOICE_STATE[r.display_state].label}</Badge>
                  </div>
                  <span className="text-[11px] text-muted">
                    {r.supplier_name} • {r.series_id ? (r.recurrence_type === "weekly" ? "هفتگی" : "ماهانه") : "یک‌باره"}
                  </span>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold">{formatToman(r.amount_irr)}</span>
                    <span className={cn("text-[11px]", r.display_state === "overdue" ? "text-danger" : "text-muted")}>{formatDate(r.due_date, "UTC")}</span>
                  </div>
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between p-4">
              <p className="text-[11px] text-muted">
                نمایش {faNumber(from)} تا {faNumber(to)} از {faNumber(total)} مورد
              </p>
              <nav className="flex items-center gap-1.5" aria-label="صفحه‌بندی">
                <button type="button" aria-label="صفحه قبل" disabled={query.page <= 1} onClick={() => setParams({ page: String(query.page - 1) }, false)} className="text-muted disabled:opacity-30">
                  <ChevronRight size={16} />
                </button>
                <Badge tone="blue">{faNumber(query.page)}</Badge>
                <button type="button" aria-label="صفحه بعد" disabled={query.page >= pages} onClick={() => setParams({ page: String(query.page + 1) }, false)} className="text-muted disabled:opacity-30">
                  <ChevronLeft size={16} />
                </button>
              </nav>
            </div>
          </>
        )}
      </Card>
      <p className="text-[11px] text-muted">مبالغ به تومان است. مبلغ معوق و نزدیک به سررسید، بخشی از مجموع پرداخت‌نشده هستند.</p>

      {form && <InvoiceFormModal invoiceId={form.id} onClose={() => setForm(null)} onSaved={() => { setForm(null); router.refresh(); }} />}
      {detail && (
        <InvoiceDetailModal
          id={detail.id}
          startWithPayment={detail.pay}
          timezone={timezone}
          onClose={() => setDetail(null)}
          onChanged={() => router.refresh()}
          onEdit={() => { setForm({ id: detail.id }); setDetail(null); }}
        />
      )}
    </>
  );
}
