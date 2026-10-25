# Implementation status

Legend: ✅ verified by automated tests · 🟡 built, but not yet run against the live Supabase project or in a browser with real data · ⛔ not done

> The live Supabase project has not been connected yet (`.env.local` is missing). Everything marked ✅ was verified by unit tests plus the full migration set running on PGlite (real Postgres 17 in-process) with Supabase's roles and RLS emulated. Screens, real Auth, Storage, pg_cron scheduling and true concurrency need the live project. Those checks are already written in `tests/integration` and `tests/e2e`.

## Spec acceptance tests (§11)

| ID | Status | Where |
|---|---|---|
| AUTH-01 anonymous → no data | ✅ PGlite · 🟡 live | identity.test.ts · live.test.ts |
| AUTH-02 employee → no invoices | ✅ PGlite · 🟡 live/e2e | invoices.test.ts · live.test.ts · flows.spec.ts |
| AUTH-03 other's leave reason denied | ✅ | calendar.test.ts (LEAVE-05 path) |
| AUTH-04 deactivated user loses access | ✅ | identity.test.ts |
| AUTH-05 no role escalation | ✅ PGlite · 🟡 live | identity.test.ts · live.test.ts |
| AUTH-06 cross-org isolation | ✅ | identity/invoices tests · live.test.ts |
| TASK-01 one-off + notification | ✅ | tasks.test.ts |
| TASK-02 concurrent claim | ✅ sequential · 🟡 true concurrency | tasks.test.ts · live.test.ts |
| TASK-03 recurring independence | ✅ | tasks.test.ts |
| TASK-04 all_assignees | ✅ | tasks.test.ts |
| TASK-05 derived overdue + one alert | ✅ | tasks.test.ts · jobs-files.test.ts |
| TASK-06 generator idempotent | ✅ | tasks.test.ts |
| TASK-07 series edit keeps history | ✅ | tasks.test.ts |
| LEAVE-01 conflict warning | ✅ · 🟡 e2e | calendar.test.ts · flows.spec.ts |
| LEAVE-02 approval → calendar block | ✅ · 🟡 e2e | calendar.test.ts · flows.spec.ts |
| LEAVE-03 forged self-approval | ✅ | calendar.test.ts |
| LEAVE-04 concurrent review | ✅ sequential · 🟡 true concurrency | calendar.test.ts · live.test.ts |
| LEAVE-05 co-worker sees no reason | ✅ · 🟡 live | calendar.test.ts · live.test.ts |
| AVAIL-01/02/03 | ✅ | calendar.test.ts |
| INV-01 toman/IRR round-trip | ✅ | money-format.test.ts · invoices.test.ts |
| INV-02 three monthly invoices | ✅ | invoices.test.ts |
| INV-03 pay one month only | ✅ | invoices.test.ts |
| INV-04 double pay | ✅ sequential · 🟡 parallel | invoices.test.ts · live.test.ts |
| INV-05 overdue + manager alert | ✅ | invoices.test.ts · jobs-files.test.ts |
| NTF-01 reminder re-run no duplicates | ✅ | tasks.test.ts · jobs-files.test.ts |
| CAL-01 Jalali/Gregorian boundary | ✅ | money-format.test.ts (+ 5,844-day Jalali cross-check) |
| CAL-02 DST repeat | ✅ by design (local-date generation keys); 🟡 no DST zone test yet | recurrence uses `(date + time) AT TIME ZONE tz` |
| FILE-01 guessed invoice file | ✅ | jobs-files.test.ts |
| UI-01 checkbox completion persists | 🟡 | flows.spec.ts |
| UI-02 KPI updates | 🟡 | flows.spec.ts |

## Screens (Figma → implementation)

| Screen | Status | Notes |
|---|---|---|
| App shell (sidebar, header, mobile nav) | ✅ visually checked against Figma at 1440 and 390 px | /dev/ui preview |
| Login / set password / reset / MFA | 🟡 | Login page render checked through the DOM |
| Dashboard | 🟡 | Role-specific DTO; employees get no invoice keys |
| Tasks (list, kanban, filters, modals, detail, completion) | 🟡 | |
| Invoices (KPIs, list, create, details, payment, success, receipt, void, CSV) | 🟡 | |
| Calendar (week, day, Jalali month, mobile strip; leave/availability/event/conflict modals) | 🟡 | |
| Team (list, invite with avatar, edit, deactivate, resend, CSV) | 🟡 | |
| Member profile | 🟡 | |
| Settings (company, account, notifications, reminders, calendar, appearance, access, activity) | 🟡 | |
| Notifications (inbox, read/all, detail) | 🟡 | |

## Hardening checklist (§9)

| Item | Status |
|---|---|
| Invitation-only onboarding, membership verified per request | ✅ code + DB tests |
| Role checks on every API route; RLS + minimal grants on every table/function | ✅ |
| No service key in the browser | ✅ (`server-only`) |
| Employees cannot read invoices, payments or audit logs | ✅ |
| Private leave reasons not exposed | ✅ |
| Attachment access checks before signed URLs | ✅ |
| Validation (Zod + DB constraints), bounded pagination, rate limits | ✅ (rate limit is per instance) |
| Atomic payment, leave decision and claim | ✅ |
| Transactional outbox + idempotent jobs | ✅ |
| Append-only, redacted audit trail | ✅ |
| CSRF origin check + SameSite cookies | ✅ |
| Private storage buckets with type and size limits | ✅ (migration) · 🟡 live |
| Dev/prod isolation, versioned migrations | ✅ migrations · ⛔ production project not created |
| Backups + storage backup/restore drill | ⛔ needs to be done by you on the live project (see README) |
| Manager MFA | ✅ implemented (on in production) · 🟡 live |
| Retention / account-removal legal review | ⛔ outside engineering scope |

**Not production-ready yet:** live verification, the backup/restore drill, custom SMTP and a production Supabase project are still outstanding.
