"use client";
// App frame from Figma: desktop sidebar + header (1:3355, 1:3126), mobile header + bottom nav (1:1046, 1:1154).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Bell, CalendarDays, ChevronDown, LayoutDashboard, ListChecks, LogOut, Menu, Receipt, Settings, Users, X, type LucideIcon } from "lucide-react";
import { Avatar, Badge, cn } from "@/components/ui/primitives";
import { HeaderSearch } from "./header-search";
import { faNumber } from "@/lib/format";

export type ShellUser = { id: string; fullName: string; avatarUrl: string | null; role: "manager" | "employee" };

type NavItem = { href: string; label: string; mobileLabel: string; icon: LucideIcon; managerOnly?: boolean };

const NAV: NavItem[] = [
  { href: "/", label: "داشبورد", mobileLabel: "داشبورد", icon: LayoutDashboard },
  { href: "/tasks", label: "تسک‌ها", mobileLabel: "تسک‌ها", icon: ListChecks },
  { href: "/invoices", label: "صورت‌حساب‌ها", mobileLabel: "پرداخت‌ها", icon: Receipt, managerOnly: true },
  { href: "/calendar", label: "تقویم و زمان‌بندی", mobileLabel: "تقویم", icon: CalendarDays },
  { href: "/team", label: "کارمندان", mobileLabel: "کارمندان", icon: Users },
  { href: "/settings", label: "تنظیمات", mobileLabel: "تنظیمات", icon: Settings },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ user, unreadCount, todayLabel, search, children }: { user: ShellUser; unreadCount: number; todayLabel: string; search?: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const items = NAV.filter((n) => !n.managerOnly || user.role === "manager");

  return (
    <div className="flex min-h-dvh bg-app">
      {/* Desktop sidebar (right side in RTL) */}
      <aside className="sticky top-0 hidden h-dvh w-[220px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-card p-4 lg:flex">
        <SidebarContent items={items} pathname={pathname} />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal aria-label="منو">
          <button type="button" aria-label="بستن منو" className="absolute inset-0 bg-ink/40" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 right-0 flex w-[260px] flex-col gap-4 overflow-y-auto bg-card p-4">
            <button type="button" onClick={() => setDrawerOpen(false)} aria-label="بستن" className="self-end text-muted">
              <X size={20} />
            </button>
            <SidebarContent items={items} pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
            <SignOutButton className="mt-auto" />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Desktop header */}
        <header className="sticky top-0 z-30 hidden h-[68px] items-center gap-4 border-b border-line bg-card px-7 lg:flex">
          {search ?? <HeaderSearch />}
          <p className="min-w-0 flex-1 text-[11px] leading-[1.7] text-muted">{todayLabel}</p>
          <Link href="/notifications" aria-label="اعلان‌ها" className="flex items-center gap-4 text-muted hover:text-ink">
            <Bell size={18} />
            {unreadCount > 0 && <Badge tone="red">{faNumber(unreadCount)}</Badge>}
          </Link>
          <UserMenu user={user} />
        </header>

        {/* Mobile header */}
        <header className="sticky top-0 z-30 flex items-center justify-between bg-card p-[18px] lg:hidden">
          <div className="flex items-center gap-3">
            <button type="button" aria-label="منو" onClick={() => setDrawerOpen(true)} className="text-ink">
              <Menu size={22} />
            </button>
            <span className="text-lg font-bold leading-[1.7] text-ink" dir="ltr">
              GBN HRM
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/notifications" aria-label="اعلان‌ها" className="relative text-ink">
              <Bell size={21} />
              {unreadCount > 0 && <span className="absolute -top-1 -left-1 size-2 rounded-full bg-danger" />}
            </Link>
            <Link href="/settings" aria-label="حساب کاربری">
              <Avatar name={user.fullName} seed={user.id} src={user.avatarUrl} size={34} />
            </Link>
          </div>
        </header>

        <main className="flex flex-1 flex-col gap-[22px] p-4 pb-28 lg:p-7">{children}</main>

        {/* Mobile bottom nav */}
        <nav className="fixed inset-x-0 bottom-0 z-30 flex items-start justify-between border-t border-line bg-card px-2 py-3.5 lg:hidden" aria-label="ناوبری">
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={cn("flex min-h-11 w-[58px] flex-col items-center gap-[5px] text-[10px] leading-[1.7]", active ? "text-brand" : "text-muted")}>
                <item.icon size={20} aria-hidden />
                {item.mobileLabel}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

function SidebarContent({ items, pathname, onNavigate }: { items: NavItem[]; pathname: string; onNavigate?: () => void }) {
  return (
    <>
      <Link href="/" onClick={onNavigate} className="w-full text-[22px] font-bold leading-[1.7] text-brand" dir="ltr" style={{ textAlign: "right" }}>
        GBN HRM
      </Link>
      <nav className="flex flex-col gap-4" aria-label="ناوبری اصلی">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn("flex items-center gap-2.5 rounded-ctl px-3 py-[13px] text-xs leading-[1.7]", active ? "bg-surface-blue font-bold text-brand" : "text-muted hover:bg-app")}
            >
              <item.icon size={18} aria-hidden />
              <span className="flex-1">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}

function UserMenu({ user }: { user: ShellUser }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" className="flex items-center gap-4">
        <ChevronDown size={14} className="text-muted" aria-hidden />
        <span className="text-xs font-bold leading-[1.7] text-ink">{user.fullName}</span>
        <Avatar name={user.fullName} seed={user.id} src={user.avatarUrl} />
      </button>
      {open && (
        <div role="menu" className="absolute top-full left-0 z-40 mt-2 flex w-[186px] flex-col gap-3 rounded-card border border-line bg-card p-4 text-xs shadow-lg">
          <Link role="menuitem" href="/settings" onClick={() => setOpen(false)} className="text-ink hover:text-brand">
            تنظیمات حساب کاربری
          </Link>
          <SignOutButton />
        </div>
      )}
    </div>
  );
}

function SignOutButton({ className }: { className?: string }) {
  return (
    <form action="/auth/sign-out" method="post" className={className}>
      <button type="submit" role="menuitem" className="flex items-center gap-2 text-xs text-danger">
        <LogOut size={16} aria-hidden />
        خروج
      </button>
    </form>
  );
}
