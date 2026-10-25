# GBN HRM — Implementation Plan

## Context

`C:\Users\mahan\Downloads\HRM GBN` is an empty git repo (remote `mhnrzp/hrm-gbn`, private). We are building **GBN HRM**: a Persian, RTL team-management app (dashboard, tasks, invoices, calendar/leave/availability, team members, settings).
Sources of truth:
- **UI:** Figma `kvS9AkUmhTq67dF7nduACb`. I read all 19 boards: 6 desktop screens, 6 mobile screens (390px, bottom nav), the monthly calendar, the employee profile, 4 modal/state boards, and the design foundations board.
- **Backend:** `GBN_HRM_Backend_Specification (1).md` v1.0.

Decisions confirmed by the user:
1. **Hosted Supabase dev project.** There is no Docker or Supabase CLI here. The CLI runs via `npx supabase` for `db push` only.
2. **Build every Figma feature the spec doesn't cover** (listed in the conflicts table below).
3. **Vercel preview deploys only.** Nothing gets promoted to production without the user's OK.

There is no existing code, so nothing gets reused. Everything below is new.

## Stack (minimal dependencies)

| Need | Choice | Why |
|---|---|---|
| App/API | Next.js App Router + TypeScript (latest stable at install) | spec §2.1 |
| DB/Auth/Storage | Supabase (`@supabase/supabase-js`, `@supabase/ssr`) | spec |
| Validation | `zod` | spec |
| Styling | Tailwind CSS v4, tokens from Figma variables (below) | Figma |
| Font | `next/font/google` → **Vazirmatn** (Figma's font) | zero deps |
| Jalali display | native `Intl.DateTimeFormat('fa-IR-u-ca-persian', {timeZone})` + `Intl.NumberFormat('fa-IR')` | native |
| Jalali date picker | `react-day-picker/persian` (v9) | only maintained option with a Persian calendar |
| Icons | `lucide-react` (confirm match via `get_design_context`) | Figma icon style |
| Tests | Vitest, Playwright | spec |

Not adding: a client cache library (Server Components + `router.refresh()` after mutations), a PDF library (the receipt is a print-styled page), a CSV library (hand-built `text/csv`), an ORM (SQL migrations + Supabase client + Postgres RPC for transactions).

**Design tokens** (from Figma variables): brand `#1877F2`, hover `#1264D8`, blue surface `#EDF4FF`, app background `#F7F9FC`, card `#FFF`, text `#1F2937` / `#64748B`, border `#E8EDF3`, success `#16A34A`, danger `#EF4444`, warning `#F59E0B`, purple `#8B5CF6`. Support surfaces: `#FEF2F2`, `#FFFBEB`, `#EFFBF3`, `#F5F0FF`. Radius 4/8/10/12/20. Spacing 4–32. Vazirmatn 400/500/700 at 10–24px.

## Architecture

- **Reads:** Server Components call `lib/services/*` with a per-request Supabase server client carrying the user's JWT, so RLS always applies. The same services back the `GET /api/v1/*` routes.
- **Writes:** client form → `POST/PATCH /api/v1/*` route handler → `requireMember()` / `requireManager()` (current membership loaded from the DB on every request) → Zod → service → **Postgres RPC function** for any multi-table write. The function runs as one transaction: business rows, `outbox_events` and `audit_logs` together. Then `router.refresh()`.
- **RPC functions** are `security invoker` by default. Any `security definer` function sets `search_path=''`, re-checks membership and role inside, and has `EXECUTE` revoked from `public`/`anon`.
- **The service-role key** is used only server-side, in `lib/supabase/admin.ts`, for invitations and the bootstrap script.
- **Jobs:** `pg_cron` calls plpgsql functions directly: occurrence generators, reminder scans, outbox processor, weekly digest. No Edge Functions. Each run writes to `job_runs`. Inserts use `ON CONFLICT DO NOTHING` on unique keys, and `pg_try_advisory_xact_lock` prevents overlapping runs.
- **Money:** `amount_irr bigint`. The API accepts and returns `amount_toman` as an integer or decimal string. `lib/money` converts with `BigInt` (×10). No floats anywhere.
- **Time:** instants are stored as `timestamptz` UTC and business dates as `date`. Recurrence expands as `(local_date + local_time) AT TIME ZONE org_tz`, so Postgres handles DST. The org-local "today" comes from `organizations.timezone` (default `Asia/Tehran`).
- **Org isolation:** every parent table has `unique (organization_id, id)`. Children use composite FKs `(organization_id, parent_id)`, so cross-org links are impossible at the DB level.

```
app/(auth)/login, auth/callback, auth/set-password, auth/reset   ← not in Figma; built from Figma primitives
app/(app)/layout.tsx         sidebar + header (desktop), header + bottom nav (mobile)
app/(app)/page.tsx           dashboard
app/(app)/tasks | invoices | calendar | team | team/[id] | settings | notifications
app/(app)/invoices/[id]/receipt   print-styled receipt
app/api/v1/...               route map from spec §5.2, plus additions below
components/ui/*              Button, Input, Select, Toggle, Badge, Card, Modal, Drawer, Table, Tabs, Avatar, Empty/Error/Loading states (board 1:77)
components/{dashboard,tasks,invoices,calendar,team,settings,notifications}/*
lib/{auth,permissions,validation,services/*,time,money,errors,supabase}
supabase/migrations/*.sql    supabase/seed.sql (dev only)
scripts/bootstrap-org.ts     creates the org + invites the first manager (service key, run locally)
tests/{unit,integration,e2e}
```

## Figma ↔ spec conflicts and resolutions

| # | Figma shows | Spec says | Resolution |
|---|---|---|---|
| 1 | Meetings (جلسه), «افزودن رویداد», event details with organizer and location, edit/delete, scheduling-conflict modal with a suggested time | No writable calendar table needed | Add `calendar_events` (type `meeting`, title, description, location, start/end, organizer) and `calendar_event_attendees`. Managers create. Attendees and managers read. Conflict check covers tasks, leave and other events. The suggested slot is the next conflict-free slot of the same length that day. |
| 2 | Leave type (استحقاقی…), balance «۱۲ روز از ۲۶ روز», used/pending days | Not covered | Add `leave_types` (`deducts_balance`) and `annual_leave_quota_days` per membership (org default 26). Used days are **derived**: approved, deducting leave in the current Jalali year, counted as org-local dates minus the org's weekend days (default Friday). Nothing is stored that could drift. |
| 3 | Attendance: حاضر / دورکار / مرخصی, KPI «حاضر در مجموعه / دورکار» | Forbids surveillance | Manager-set `work_mode` (`office`/`remote`) on the membership. «مرخصی» is derived from approved leave today. No tracking. |
| 4 | Task progress % and «ثبت به‌روزرسانی پیشرفت» | Only `progress_status` | Add `progress_percent smallint 0–100` on `task_occurrence_assignees`. Each update writes a `task_updates` row of type `progress`. |
| 5 | Task form has one «مسئول» select | Multi-assignee, team pool, completion policy | The schema follows the spec. The UI keeps Figma's single select, plus one extra option «صف تیم» (team pool) in the same dropdown. Multi-assignee works through the API only (no Figma UI). |
| 6 | Leave form has a «کارمند» select; reason marked required; rejection reason required | Reason optional; manager self-leave is an override | Employees can only pick themselves. A manager filing for someone else, or for themselves, is an audited override. Reason is required (Figma). Rejection requires `manager_comment`. |
| 7 | Invoice «دریافت‌کننده», invoice number ۱۴۰۵/۰۰۱, «یادآوری پیش از موعد» toggle, payment method and tracking number | `supplier_name`, reminder days per user | `supplier_name` is free text. `invoice_reference` auto-numbers per org per Jalali year. Add `reminder_enabled` on invoice and series. `payment_records.method` enum: `bank_transfer, card, cash, cheque, other`. |
| 8 | «دریافت گزارش», «خروجی اطلاعات», «دریافت رسید» | Not covered | `GET /invoices/export.csv` and `GET /team-members/export.csv` (manager only, UTF-8 BOM for Excel). The receipt is a print-styled page. |
| 9 | Global header search | Not covered | `GET /api/v1/search?q=` runs a role-filtered `ILIKE` over tasks, members and invoices (invoices for managers only). |
| 10 | Kanban tab on Tasks | — | Same data grouped by status. Drag changes status within role rules. |
| 11 | Settings: org code, phone, email, address; weekly team summary (Saturday 08:00); compact tables; theme/language/calendar-type selects; «ویرایش مجوزها» | Partly covered | Org columns are added. A weekly digest job is added. Compact-tables is a per-user preference. Theme, language and calendar type each offer the single designed value (light / Persian / Jalali). Roles stay fixed in V1, so «ویرایش مجوزها» opens a read-only permission matrix. |
| 12 | Notification toggles: in-app, email, leave requests, task status | `in_app/email/reminder days` | Add per-category booleans. Critical alerts (assignment, leave decision, overdue) ignore the toggles, per spec. |
| 13 | Profile: mobile, start date, direct manager | `phone` | Add `profiles.phone` (manager and self only), `memberships.joined_at` and `memberships.manager_id`. |
| 14 | No login screens in Figma | Invitation-only auth, MFA | Build login, set-password, reset and MFA pages from Figma primitives (card, inputs, primary button). This is a necessary addition, not a redesign. |

## Migration order (`supabase/migrations`, each with RLS, grants and indexes)

1. `0001_foundation`: extensions (`pgcrypto`, `pg_cron`); helpers `is_active_member(org)`, `is_manager(org)` (stable, `search_path=''`); `set_updated_at` trigger; error-code conventions.
2. `0002_org_identity`: `organizations` (+ timezone, weekend_days, leave quota default, address/phone/email/code), `profiles`, `organization_memberships` (+ work_mode, manager_id, job_title, quota), `invitations` (hashed token only). RLS: an employee sees a minimal directory **view**; private columns are only reachable through a manager or self path.
3. `0003_platform`: `notification_preferences`, `user_preferences` (compact tables), `notifications` (unique `(recipient_user_id, dedupe_key)`), `outbox_events`, `audit_logs` (append-only: no update/delete grants), `job_runs`.
4. `0004_tasks`: `tasks`, `task_assignees`, `task_occurrences` (unique `(task_id, generation_key)`), `task_occurrence_assignees` (+ `progress_percent`), `task_updates`. RPCs: `create_task`, `update_task_series`, `archive_task`, `claim_occurrence` (conditional update → `TASK_ALREADY_CLAIMED`), `complete_assignment` (any_one / all_assignees), `add_task_update`.
5. `0005_leave`: `leave_types`, `leave_requests` (`end_at > start_at`, exclusion constraint on approved overlap per employee via `btree_gist`). RPCs: `submit_leave`, `review_leave` (row lock, state check → `LEAVE_ALREADY_REVIEWED`), `cancel_leave`. Function `leave_balance(member, year)`. Safe calendar projection with no reasons.
6. `0006_availability`: `availability_rules`, `availability_occurrences` (unique `(rule_id, generation_key)`).
7. `0007_calendar_events`: `calendar_events`, `calendar_event_attendees`. Function `find_conflicts(employee, start, end)` returns the conflict kinds `approved_leave`, `no_declared_availability`, `already_scheduled_work`, `available`.
8. `0008_invoices`: `invoice_series`, `invoices` (unique `(series_id, generation_key)`, auto reference), `payment_records` (unique `invoice_id` for V1 single settlement, idempotency key). RPCs: `mark_invoice_paid`, `void_payment` (reason required, audited). Employees get **no grants**, not just RLS.
9. `0009_attachments`: `attachments` table, a private `attachments` bucket, and storage policies that check the owning entity's permission. Signed URLs live 60 seconds.
10. `0010_jobs`: `generate_task_occurrences` (90-day horizon, hourly), `generate_invoice_occurrences` (daily), `generate_availability_occurrences` (daily), `scan_task_reminders` (hourly), `scan_invoice_reminders` (daily, 08:00 org-local), `process_outbox` (every minute), `weekly_digest`, `job_health_check`, plus the `cron.schedule` calls.

## API additions beyond spec §5.2

`/calendar-events` (CRUD + `/conflicts`), `/leave-types`, `/leave-balance/:memberId`, `/search`, `/invoices/export.csv`, `/team-members/export.csv`, `/invoices/:id/receipt` (page). Every route returns the spec's envelope: `{data, meta.request_id}` or `{error:{code, message_fa, details}}`. Persian messages come from one map in `lib/errors`.

## Screen → endpoint map

| Screen (node) | Bindings |
|---|---|
| Dashboard (1:3124, mobile 1:1045) | `GET /dashboard` (4 KPIs, important tasks, payments, pending leave, week preview, notifications). Task checkbox → `/task-occurrences/:id/complete`. «افزودن زمان» → availability modal. Employees get a role-specific DTO with no invoice fields. |
| Tasks (1:2952, 1:931, states 1:1665) | `GET /task-occurrences` with status/assignee/priority/due filters, counts per status chip, cursor pagination. New/edit modals → `POST /tasks`, `PATCH /tasks/:id`. Detail drawer → progress, comments, complete. Kanban tab. |
| Invoices (1:2810, 1:811, states 1:1522) | `GET /invoices` (4 KPI sums, overdue banner, month and state filters). New → `POST /invoices` or `/invoice-series`. Details, then mark-paid modal → `/invoices/:id/mark-paid`. Receipt. CSV export. |
| Calendar week/day/month (1:2601, 1:1849, 1:664, states 1:1306) | `GET /calendar?from&to&employee_ids` (≤90 days). Leave request/review/reject modals. Add availability. Event details, conflict modal. Pending-requests and conflicts panels. |
| Team (1:2428, 1:498), add member (1:1179) | `GET /team-members` (KPIs, filters). `POST /team-members/invitations` (avatar upload via attachments, send-invite toggle). CSV export. |
| Profile (1:2024) | `GET /team-members/:id` (role-filtered), leave balance, active tasks with progress, availability and meetings, recent activity. «تخصیص تسک» and «ثبت مرخصی» prefill the modals. |
| Settings (1:2194, 1:361) | `GET/PATCH /settings/{profile,notifications,company}`, password change (Supabase Auth), avatar, `GET /audit-logs`. |
| Notifications (1:1179) | Bell count, panel with all/unread tabs, mark one read, read-all, detail modal → entity deep link. |

## Milestones (each ends with tests passing, a Figma visual check, then commit + push to `origin/main`)

- **M0 Scaffold.** `create-next-app` (TS, Tailwind, App Router, pnpm). Set up tokens, Vazirmatn, `dir="rtl" lang="fa"`. Build the `components/ui` kit from board 1:77 using `get_design_context`, after loading the `figma-design-to-code` skill. Add the app shell (sidebar, header, mobile bottom nav), `.env.example`, a `.gitignore` covering `.env*.local`, and `BACKEND_IMPLEMENTATION_PLAN.md` (this plan).
  **User step:** create the Supabase project (free tier, EU region), fill `.env.local` yourself, and in Auth settings disable public sign-ups and set the Site URL. I will list the exact clicks.
- **M1 Foundation.** Migrations 0001–0003. Auth pages, `lib/auth` (`getMember()`, `requireManager()`), the error envelope, audit helper, bootstrap script, invitations. RLS tests AUTH-01…06.
- **M2 Tasks.** Migration 0004 plus the 0010 task jobs. Task screens, modals, kanban, claims. Tests TASK-01…07, UI-01.
- **M3 Leave, availability, calendar, meetings.** Migrations 0005–0007 plus their jobs. Calendar week/day/month, leave flow, balance, conflicts. Tests LEAVE-01…05, AVAIL-01…03, CAL-01/02.
- **M4 Invoices.** Migration 0008 plus invoice jobs. Invoice screens, mark-paid, void, receipt, CSV. Tests INV-01…05.
- **M5 Dashboard, notifications, team, settings, files.** Migration 0009, outbox processor, digest, dashboard aggregations, team and profile, settings, search, attachments. Tests NTF-01, FILE-01, UI-02.
- **M6 Hardening and deploy.** Manager TOTP MFA (Supabase MFA, enforced at aal2 for manager routes), rate limiting on auth and mutation routes, Origin check against CSRF on cookie-auth mutations, dev-only seed with fictional Persian data, README (env names, setup, migrations, bootstrap, tests, backup and restore notes), a final screen-by-screen checklist marked complete/partial/missing. Vercel preview deploy (the user sets env vars in Vercel; I never handle secret values), then e2e smoke against the preview URL.

## Verification

- `pnpm test`: Vitest unit tests for money round-trips (`12_500_000 toman ↔ 125_000_000 IRR`), Jalali/tz conversions including the Gregorian boundary, DTO projections.
- `pnpm test:integration`: Vitest against the dev Supabase project. Each run creates two throwaway orgs, each with one manager and two employees, created through the admin API. It covers every spec §11 ID (AUTH/TASK/LEAVE/AVAIL/INV/NTF/CAL/FILE): forged calls, cross-org IDs, concurrent claim and review (`Promise.all`), job re-runs proving no duplicates. Test orgs are torn down with the service key.
- `pnpm test:e2e`: Playwright with manager and employee sessions on localhost. Covers creating a task → the employee sees and completes it → the dashboard KPI updates (UI-01/02), leave request → manager conflict warning → approval → red calendar block, invoice create → mark paid → receipt.
- **Visual check per screen:** run the dev server, open it in the browser pane at 1440px and 390px, and compare against the Figma screenshots.
- Nothing is reported as working unless its test ran green. Failures are reported as-is.
