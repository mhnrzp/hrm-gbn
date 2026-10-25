"use client";
// Interactive controls matching Figma board 1:77 (فیلد فرم، کلید، پنجره، فهرست بازشو).
import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronDown, Clock3, X } from "lucide-react";
import { DayPicker } from "@daypicker/persian";
import "@daypicker/react/style.css";
import { cn, Alert, Button } from "./primitives";
import { faDigits, formatDate } from "@/lib/format";

/* ── Form field shell: bordered box, 10px label over 12px value ─────────── */

type FieldShellProps = { label: string; required?: boolean; error?: string; icon?: ReactNode; htmlFor?: string; className?: string; children: ReactNode };

export function FieldShell({ label, required, error, icon, htmlFor, className, children }: FieldShellProps) {
  return (
    <div
      className={cn(
        "relative flex min-h-[70px] flex-col gap-1 rounded-ctl border bg-card p-[11px] focus-within:border-brand",
        error ? "border-danger" : "border-line",
        className,
      )}
    >
      <label htmlFor={htmlFor} className="text-[10px] leading-[1.7] text-muted">
        {label}
        {required && " *"}
      </label>
      <div className={cn("flex items-center gap-2", icon && "pl-6")}>{children}</div>
      {icon && <span className="pointer-events-none absolute bottom-[22px] left-2.5 text-muted">{icon}</span>}
      {error && <p className="text-[11px] leading-[1.7] text-danger">{error}</p>}
    </div>
  );
}

const inputClass = "w-full min-w-0 bg-transparent text-xs leading-[1.7] text-ink outline-none placeholder:text-muted";

export function TextField({ label, required, error, className, id, ...rest }: Omit<ComponentProps<"input">, "className"> & { label: string; error?: string; className?: string }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <FieldShell label={label} required={required} error={error} htmlFor={inputId} className={className}>
      <input id={inputId} required={required} aria-invalid={!!error} className={inputClass} {...rest} />
    </FieldShell>
  );
}

export function TextAreaField({ label, required, error, className, id, rows = 4, ...rest }: Omit<ComponentProps<"textarea">, "className"> & { label: string; error?: string; className?: string }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <FieldShell label={label} required={required} error={error} htmlFor={inputId} className={className}>
      <textarea id={inputId} rows={rows} required={required} aria-invalid={!!error} className={cn(inputClass, "resize-none")} {...rest} />
    </FieldShell>
  );
}

export type Option = { value: string; label: string };

export function SelectField({ label, required, error, className, id, options, placeholder, ...rest }: Omit<ComponentProps<"select">, "className"> & { label: string; error?: string; className?: string; options: Option[]; placeholder?: string }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <FieldShell label={label} required={required} error={error} htmlFor={inputId} className={className} icon={<ChevronDown size={16} />}>
      <select id={inputId} required={required} aria-invalid={!!error} className={cn(inputClass, "cursor-pointer appearance-none")} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

/** 15-minute steps rendered with Persian digits; value is "HH:MM". */
const TIME_OPTIONS: Option[] = Array.from({ length: 96 }, (_, i) => {
  const v = `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`;
  return { value: v, label: faDigits(v) };
});

export function TimeField(props: Omit<ComponentProps<typeof SelectField>, "options">) {
  const { value } = props;
  const options = typeof value === "string" && value && !TIME_OPTIONS.some((o) => o.value === value) ? [{ value, label: faDigits(value) }, ...TIME_OPTIONS] : TIME_OPTIONS;
  return (
    <FieldShell label={props.label} required={props.required} error={props.error} className={props.className} icon={<Clock3 size={16} />}>
      <select
        aria-label={props.label}
        className={cn(inputClass, "cursor-pointer appearance-none")}
        value={props.value}
        onChange={props.onChange}
        required={props.required}
        disabled={props.disabled}
        name={props.name}
      >
        {props.placeholder !== undefined && <option value="">{props.placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

/** Jalali date picker. Value/onChange use Gregorian "YYYY-MM-DD" (what the API stores). */
export function DateField({ label, value, onChange, required, error, className, placeholder = "انتخاب تاریخ", disabled }: { label: string; value: string; onChange: (iso: string) => void; required?: boolean; error?: string; className?: string; placeholder?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !boxRef.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const selected = value ? new Date(`${value}T12:00:00`) : undefined;
  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <FieldShell label={label} required={required} error={error} icon={<CalendarDays size={16} />}>
        <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} className={cn(inputClass, "text-right", !value && "text-muted")} aria-haspopup="dialog" aria-expanded={open}>
          {value ? formatDate(value, "UTC") : placeholder}
        </button>
      </FieldShell>
      {open && (
        <div className="absolute top-full right-0 z-50 mt-1 rounded-card border border-line bg-card p-2 shadow-lg" role="dialog" aria-label={label}>
          <DayPicker
            mode="single"
            selected={selected}
            defaultMonth={selected}
            onSelect={(d) => {
              if (!d) return;
              onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
              setOpen(false);
            }}
            weekStartsOn={6}
          />
        </div>
      )}
    </div>
  );
}

/* ── Toggle (کلید) ─────────────────────────────────────────────────────── */

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-center gap-5 py-[11px]">
      <div className="min-w-0 flex-1">
        <p id={id} className="text-xs font-bold leading-[1.7] text-ink">
          {label}
        </p>
        {description && <p className="text-[10px] leading-[1.7] text-muted">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        dir="ltr"
        className={cn("flex h-5 w-[34px] shrink-0 items-start rounded-xl p-[3px] transition-colors disabled:opacity-50", checked ? "justify-end bg-brand" : "justify-start bg-line")}
      >
        <span className="size-3.5 rounded-full bg-card" />
      </button>
    </div>
  );
}

/* ── Modal / drawer (پنجره فرم، پنل کشویی) ───────────────────────────── */

export function Modal({ open, onClose, title, subtitle, children, footer, width = 420 }: { open: boolean; onClose: () => void; title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto max-h-[92vh] w-[calc(100vw-24px)] overflow-visible rounded-lg border border-line bg-card p-0 text-ink backdrop:bg-ink/40"
      style={{ maxWidth: width }}
    >
      {open && (
        <div className="flex max-h-[92vh] flex-col gap-4 overflow-y-auto p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-bold leading-[1.8]">{title}</h2>
              {subtitle && <p className="text-[11px] leading-[1.7] text-muted">{subtitle}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label="بستن" className="mt-1 text-muted hover:text-ink">
              <X size={18} />
            </button>
          </div>
          {children}
          {footer && <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/* ── Segmented tabs (فهرست/کانبان، روزانه/هفتگی/ماهانه) ─────────────── */

export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string }) {
  return (
    <div role="tablist" className={cn("inline-flex rounded-ctl bg-app p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("rounded-[6px] px-3.5 py-1.5 text-xs leading-[1.7]", value === o.value ? "bg-card font-bold text-brand shadow-sm" : "text-muted hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── Error state with retry (حالت خطا) ───────────────────────────────── */

export function ErrorState({ title = "دریافت اطلاعات انجام نشد", message = "اتصال شبکه را بررسی و دوباره تلاش کنید.", onRetry }: { title?: string; message?: string; onRetry?: () => void }) {
  const router = useRouter();
  return (
    <div className="flex flex-col items-start gap-4 p-4">
      <Alert title={title} className="w-full">
        {message}
      </Alert>
      <Button variant="secondary" onClick={onRetry ?? (() => router.refresh())}>
        تلاش دوباره
      </Button>
    </div>
  );
}
