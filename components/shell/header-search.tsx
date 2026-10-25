"use client";
// Header «جستجو...»: debounced, role-filtered results across tasks, people and (managers) invoices.
import Link from "next/link";
import { useEffect, useState } from "react";
import { ListChecks, Receipt, Search, UserRound } from "lucide-react";
import { useDismiss } from "@/components/ui/controls";
import { api } from "@/lib/client-api";

type Result = { type: "task" | "member" | "invoice"; id: string; title: string; subtitle: string; href: string };
const ICON = { task: ListChecks, member: UserRound, invoice: Receipt };

export function HeaderSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    let alive = true;
    const t = setTimeout(() => {
      api<{ items: Result[] }>(`/search?q=${encodeURIComponent(term)}`)
        .then((r) => alive && setResults(r.items))
        .catch(() => alive && setResults([]));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div ref={ref} className="relative" role="search">
      <label className="flex h-[38px] w-[260px] items-center gap-2 rounded-ctl border border-line bg-card px-3 focus-within:border-brand">
        <Search size={16} className="text-muted" aria-hidden />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            if (e.target.value.trim().length < 2) setResults(null);
          }}
          onFocus={() => setOpen(true)}
          placeholder="جستجو..."
          aria-label="جستجو"
          className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-muted"
        />
      </label>
      {open && results && (
        <div className="absolute top-full right-0 z-50 mt-1 w-[320px] rounded-card border border-line bg-card p-2 shadow-lg">
          {results.length === 0 ? (
            <p className="p-2 text-xs text-muted">نتیجه‌ای پیدا نشد.</p>
          ) : (
            results.map((r) => {
              const Icon = ICON[r.type];
              return (
                <Link key={`${r.type}-${r.id}`} href={r.href} onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-[6px] p-2 hover:bg-app">
                  <Icon size={16} className="text-muted" aria-hidden />
                  <span className="flex min-w-0 flex-col text-xs">
                    <span className="truncate font-bold">{r.title}</span>
                    <span className="truncate text-[11px] text-muted">{r.subtitle}</span>
                  </span>
                </Link>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
