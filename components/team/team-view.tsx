"use client";
// Figma: مدیریت کارمندان (1:2428), mobile (1:498), «افزودن کارمند» (1:1179).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CalendarX2, ChevronDown, Download, Filter, House, MoreHorizontal, Plus, Search, UserCheck, Users } from "lucide-react";
import { Alert, Avatar, Badge, Button, Card, CardHeader, EmptyState, PageTitle, StatCard, Table, Td, Th } from "@/components/ui/primitives";
import { FilterMenu, Menu } from "@/components/ui/controls";
import { api, ApiError } from "@/lib/client-api";
import { faNumber } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/labels";
import type { DirectoryRow } from "@/lib/services/team";
import { presence } from "./presence";
import { InviteMemberModal, EditMemberModal } from "./member-modals";

type Row = DirectoryRow & { avatar_url: string | null };
export type TeamMe = { userId: string; role: "manager" | "employee"; orgId: string; timezone: string };

export function TeamView({ rows, me }: { rows: Row[]; me: TeamMe }) {
  const router = useRouter();
  const isManager = me.role === "manager";
  const [q, setQ] = useState("");
  const [role, setRole] = useState<"manager" | "employee" | undefined>();
  const [status, setStatus] = useState<"present" | "remote" | "leave" | "invited" | "inactive" | undefined>();
  const [modal, setModal] = useState<{ kind: "invite" } | { kind: "edit"; row: Row } | null>(null);
  const [notice, setNotice] = useState<{ tone: "green" | "red"; text: string } | null>(null);

  const active = rows.filter((r) => r.status === "active");
  const stats = {
    total: active.length,
    present: active.filter((r) => !r.on_leave_today && r.work_mode === "office").length,
    remote: active.filter((r) => !r.on_leave_today && r.work_mode === "remote").length,
    leave: active.filter((r) => r.on_leave_today).length,
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("fa");
    return rows.filter((r) => {
      if (needle && !`${r.full_name} ${r.job_title} ${r.email ?? ""}`.toLocaleLowerCase("fa").includes(needle)) return false;
      if (role && r.role !== role) return false;
      const p = presence(r).label;
      const map = { present: "حاضر", remote: "دورکار", leave: "مرخصی", invited: "دعوت‌شده", inactive: "غیرفعال" } as const;
      return !status || p === map[status];
    });
  }, [rows, q, role, status]);

  async function act(action: () => Promise<unknown>, ok: string) {
    setNotice(null);
    try {
      await action();
      setNotice({ tone: "green", text: ok });
      router.refresh();
    } catch (e) {
      setNotice({ tone: "red", text: e instanceof ApiError ? e.messageFa : "انجام نشد." });
    }
  }

  return (
    <>
      <PageTitle title="مدیریت کارمندان" subtitle="اطلاعات اعضای تیم، سطح دسترسی و وضعیت حضور" actions={isManager && <Button icon={Plus} onClick={() => setModal({ kind: "invite" })}>افزودن کارمند</Button>} />

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StatCard value={faNumber(stats.total)} label="کل کارمندان" icon={Users} tone="blue" />
        <StatCard value={faNumber(stats.present)} label="حاضر در مجموعه" icon={UserCheck} tone="green" />
        <StatCard value={faNumber(stats.remote)} label="دورکار" icon={House} tone="purple" />
        <StatCard value={faNumber(stats.leave)} label="مرخصی امروز" icon={CalendarX2} tone="red" />
      </div>

      {notice && <Alert tone={notice.tone} title={notice.text} />}

      <Card>
        <CardHeader
          title="فهرست کارمندان"
          actions={isManager && <a href="/api/v1/team-members/export.csv" download><Button variant="secondary" icon={Download}>خروجی اطلاعات</Button></a>}
        />
        <div className="flex flex-col gap-3 px-[18px] pb-[18px] lg:flex-row lg:items-center lg:justify-between">
          <label className="flex h-[38px] w-full items-center gap-2 rounded-ctl border border-line bg-card px-3 focus-within:border-brand lg:w-[310px]">
            <Search size={16} className="text-muted" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو..." aria-label="جستجوی کارمند" className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted" />
          </label>
          <div className="flex flex-wrap gap-2.5">
            <FilterMenu label="همه دسترسی‌ها" allLabel="همه دسترسی‌ها" icon={Filter} value={role} onChange={setRole} options={[{ value: "manager", label: "مدیر" }, { value: "employee", label: "کارمند" }]} />
            <FilterMenu label="همه وضعیت‌ها" allLabel="همه وضعیت‌ها" icon={ChevronDown} value={status} onChange={setStatus}
              options={[{ value: "present", label: "حاضر" }, { value: "remote", label: "دورکار" }, { value: "leave", label: "مرخصی" }, ...(isManager ? [{ value: "invited" as const, label: "دعوت‌شده" }, { value: "inactive" as const, label: "غیرفعال" }] : [])]} />
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState message="عضوی با این مشخصات پیدا نشد." action={isManager && rows.length <= 1 && <Button icon={Plus} onClick={() => setModal({ kind: "invite" })}>افزودن کارمند</Button>} />
        ) : (
          <>
            <div className="hidden lg:block">
              <Table>
                <thead>
                  <tr>
                    <Th>تصویر پروفایل</Th>
                    <Th>نام و نام خانوادگی</Th>
                    <Th>سمت</Th>
                    <Th>سطح دسترسی</Th>
                    <Th>تسک‌های فعال</Th>
                    <Th>وضعیت حضور</Th>
                    <Th>عملیات</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const p = presence(r);
                    return (
                      <tr key={r.user_id}>
                        <Td><Avatar name={r.full_name} seed={r.user_id} src={r.avatar_url} /></Td>
                        <Td>{r.full_name}</Td>
                        <Td>{r.job_title || "—"}</Td>
                        <Td><Badge tone={r.role === "manager" ? "purple" : "gray"}>{ROLE_LABEL[r.role]}</Badge></Td>
                        <Td>{r.active_task_count === null ? "—" : faNumber(r.active_task_count)}</Td>
                        <Td><Badge tone={p.tone}>{p.label}</Badge></Td>
                        <Td>
                          <RowActions row={r} isManager={isManager} me={me.userId}
                            onEdit={() => setModal({ kind: "edit", row: r })}
                            onDeactivate={() => window.confirm(`حساب ${r.full_name} غیرفعال شود؟ سوابق حفظ می‌شود.`) && act(() => api(`/team-members/${r.user_id}`, { method: "PATCH", body: { status: "inactive" } }), "حساب غیرفعال شد.")}
                            onActivate={() => act(() => api(`/team-members/${r.user_id}`, { method: "PATCH", body: { status: "active" } }), "حساب دوباره فعال شد.")}
                            onResend={() => act(() => api(`/team-members/${r.user_id}/resend-invite`, { method: "POST" }), "ایمیل دعوت دوباره ارسال شد.")} />
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
            <div className="flex flex-col gap-3 px-[18px] pb-4 lg:hidden">
              {filtered.map((r) => {
                const p = presence(r);
                return (
                  <Link key={r.user_id} href={`/team/${r.user_id}`} className="flex items-center gap-3 rounded-card border border-line p-4">
                    <Avatar name={r.full_name} seed={r.user_id} src={r.avatar_url} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-bold">{r.full_name}</p>
                      <p className="text-[11px] text-muted">{r.job_title || ROLE_LABEL[r.role]}</p>
                    </div>
                    <Badge tone={p.tone}>{p.label}</Badge>
                  </Link>
                );
              })}
            </div>
            <p className="p-4 text-[11px] text-muted">نمایش {faNumber(filtered.length)} از {faNumber(rows.length)} مورد</p>
          </>
        )}
      </Card>

      <Card>
        <CardHeader title="دسترسی‌های مجموعه" />
        <div className="grid gap-4 p-[18px] pt-0 md:grid-cols-2">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs">مدیریت اعضا، تسک‌ها، صورت‌حساب‌ها و تأیید درخواست‌های مرخصی.</p>
            <Badge tone="purple">مدیر</Badge>
          </div>
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs">مشاهده و مدیریت تسک‌های خود، ثبت زمان آزاد و درخواست مرخصی.</p>
            <Badge tone="gray">کارمند</Badge>
          </div>
        </div>
      </Card>

      {modal?.kind === "invite" && <InviteMemberModal me={me} onClose={() => setModal(null)} onSaved={(text) => { setModal(null); setNotice({ tone: "green", text }); router.refresh(); }} />}
      {modal?.kind === "edit" && <EditMemberModal row={modal.row} me={me} members={rows.filter((r) => r.status === "active")} onClose={() => setModal(null)} onSaved={() => { setModal(null); router.refresh(); }} />}
    </>
  );
}

function RowActions({ row, isManager, me, onEdit, onDeactivate, onActivate, onResend }: { row: Row; isManager: boolean; me: string; onEdit: () => void; onDeactivate: () => void; onActivate: () => void; onResend: () => void }) {
  return (
    <span className="flex items-center gap-1">
      <Link href={`/team/${row.user_id}`} className="hover:text-brand">
        مشاهده پروفایل
      </Link>
      {isManager && (
        <Menu
          align="end"
          trigger={({ toggle }) => (
            <button type="button" onClick={toggle} aria-label={`عملیات ${row.full_name}`} className="px-1 text-muted hover:text-ink">
              <MoreHorizontal size={16} />
            </button>
          )}
          items={[
            { key: "edit", label: "ویرایش اطلاعات", onSelect: onEdit },
            ...(row.status === "invited" ? [{ key: "resend", label: "ارسال مجدد دعوت", onSelect: onResend }] : []),
            ...(row.status === "inactive" ? [{ key: "activate", label: "فعال‌سازی دوباره", onSelect: onActivate }] : []),
            ...(row.status === "active" && row.user_id !== me ? [{ key: "deactivate", label: "غیرفعال‌سازی", danger: true, onSelect: onDeactivate }] : []),
          ]}
        />
      )}
    </span>
  );
}
