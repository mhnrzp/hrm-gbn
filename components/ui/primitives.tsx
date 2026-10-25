// Server-safe building blocks matching Figma board "مبانی بصری و نمونه‌های اجزا" (1:77).
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { TriangleAlert } from "lucide-react";
import { initials } from "@/lib/format";

export function cn(...classes: unknown[]) {
  return classes.filter((c): c is string => typeof c === "string" && c !== "").join(" ");
}

/* ── Button ─────────────────────────────────────────────────────────────── */

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const buttonBase =
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-[7px] whitespace-nowrap rounded-ctl border px-3.5 py-[9px] text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:border-line disabled:bg-line disabled:text-muted";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "border-brand bg-brand text-white hover:border-brand-hover hover:bg-brand-hover",
  secondary: "border-line bg-card text-ink hover:bg-app",
  danger: "border-danger bg-danger text-white hover:opacity-90",
  ghost: "border-transparent bg-transparent text-brand hover:bg-surface-blue",
};

type ButtonOwnProps = { variant?: ButtonVariant; icon?: LucideIcon; children?: ReactNode };

export function Button({ variant = "primary", icon: Icon, className, children, type = "button", ...rest }: ButtonOwnProps & ComponentProps<"button">) {
  return (
    <button type={type} className={cn(buttonBase, buttonVariants[variant], className)} {...rest}>
      {Icon && <Icon size={16} aria-hidden />}
      {children}
    </button>
  );
}

export function ButtonLink({ variant = "primary", icon: Icon, className, children, ...rest }: ButtonOwnProps & ComponentProps<typeof Link>) {
  return (
    <Link className={cn(buttonBase, buttonVariants[variant], className)} {...rest}>
      {Icon && <Icon size={16} aria-hidden />}
      {children}
    </Link>
  );
}

/* ── Badge ──────────────────────────────────────────────────────────────── */

export type Tone = "blue" | "gray" | "amber" | "red" | "green" | "purple";

export const toneClasses: Record<Tone, string> = {
  blue: "bg-surface-blue text-brand",
  gray: "bg-app text-muted",
  amber: "bg-tint-amber text-warning",
  red: "bg-tint-red text-danger",
  green: "bg-tint-green text-success",
  purple: "bg-tint-purple text-purple",
};

export function Badge({ tone = "blue", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center whitespace-nowrap rounded-badge px-2 py-[3px] text-[11px] leading-[1.7]", toneClasses[tone], className)}>
      {children}
    </span>
  );
}

/* ── Avatar ─────────────────────────────────────────────────────────────── */

const avatarTones: Tone[] = ["purple", "blue", "amber", "green", "red"];

/** Stable tint per person, like the Figma avatars. */
export function avatarTone(seed: string): Tone {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return avatarTones[Math.abs(h) % avatarTones.length];
}

export function Avatar({ name, seed, src, size = 32, className }: { name: string; seed?: string; src?: string | null; size?: number; className?: string }) {
  const tone = avatarTone(seed ?? name);
  const fontSize = size >= 80 ? 28 : size >= 40 ? Math.round(size * 0.4) : 11;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-card font-bold leading-[1.7]", toneClasses[tone], className)}
      style={{ width: size, height: size, fontSize }}
      aria-hidden
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed Storage URLs; next/image would cache them past expiry */}
      {src ? <img src={src} alt="" className="size-full object-cover" /> : initials(name)}
    </span>
  );
}

/* ── Cards ──────────────────────────────────────────────────────────────── */

export function Card({ className, children, ...rest }: ComponentProps<"section">) {
  return (
    <section className={cn("overflow-hidden rounded-card border border-line bg-card", className)} {...rest}>
      {children}
    </section>
  );
}

export function CardHeader({ title, actions, className }: { title: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 px-[18px] py-3.5", className)}>
      <h2 className="min-w-0 flex-1 text-sm font-bold leading-[1.7] text-ink">{title}</h2>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold leading-[1.8] text-ink">{title}</h1>
        {subtitle && <p className="text-xs leading-[1.8] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ value, label, hint, icon: Icon, tone = "blue", hintTone }: { value: ReactNode; label: string; hint?: ReactNode; icon: LucideIcon; tone?: Tone; hintTone?: Tone }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3.5 rounded-card border border-line bg-card p-[18px]">
      <div className="min-w-0 flex-1">
        <p className="text-[23px] font-bold leading-[1.8] text-ink">{value}</p>
        <p className="text-xs leading-[1.8] text-muted">{label}</p>
        {hint && <p className={cn("text-[10px] leading-[1.7]", hintTone ? toneClasses[hintTone].split(" ")[1] : "text-muted")}>{hint}</p>}
      </div>
      <span className={cn("flex size-[42px] shrink-0 items-center justify-center rounded-ctl", toneClasses[tone])}>
        <Icon size={21} aria-hidden />
      </span>
    </div>
  );
}

/* ── Table ──────────────────────────────────────────────────────────────── */

export function Table({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-right text-[11px] leading-[1.7]", className)}>{children}</table>
    </div>
  );
}

export function Th({ className, children }: { className?: string; children?: ReactNode }) {
  return <th className={cn("bg-app px-4 py-[11px] text-[11px] font-bold whitespace-nowrap text-muted first:pr-4", className)}>{children}</th>;
}

export function Td({ className, children, ...rest }: ComponentProps<"td">) {
  return (
    <td className={cn("data-row h-[62px] border-b border-line px-4 align-middle text-ink", className)} {...rest}>
      {children}
    </td>
  );
}

/* ── Alerts and system states ───────────────────────────────────────────── */

const alertTones = {
  red: { box: "bg-tint-red", title: "text-danger" },
  amber: { box: "bg-tint-amber", title: "text-warning" },
  green: { box: "bg-tint-green", title: "text-success" },
  blue: { box: "bg-surface-blue", title: "text-brand" },
} as const;

export function Alert({ tone = "red", title, children, icon: Icon = TriangleAlert, className }: { tone?: keyof typeof alertTones; title: ReactNode; children?: ReactNode; icon?: LucideIcon; className?: string }) {
  const t = alertTones[tone];
  return (
    <div role={tone === "red" ? "alert" : "status"} className={cn("flex items-start gap-3 rounded-ctl p-3.5", t.box, className)}>
      <Icon size={20} className={cn("shrink-0", t.title)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={cn("text-xs font-bold leading-[1.8]", t.title)}>{title}</p>
        {children && <div className="text-[11px] leading-[1.8] text-ink">{children}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-4 p-4">
      <p className="text-xs leading-[1.7] text-ink">{message}</p>
      {action}
    </div>
  );
}

export function LoadingState({ label = "در حال بارگذاری..." }: { label?: string }) {
  return (
    <div className="flex items-center gap-2.5 p-4" role="status">
      <span className="text-[11px] text-muted">{label}</span>
      <span className="h-3 w-[180px] animate-pulse rounded-xs bg-line" />
    </div>
  );
}
