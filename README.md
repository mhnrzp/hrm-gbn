# GBN HRM

A Persian (RTL, Jalali) team-management workspace: dashboard, tasks, invoices and payments, team calendar with leave and availability, team members, and settings. The UI follows the Figma file `HRM-GBN`. The backend follows `BACKEND_IMPLEMENTATION_PLAN.md` and the GBN HRM backend specification.

**Stack:** Next.js 16 (App Router, TypeScript), Tailwind v4, Supabase (Postgres, Auth, Storage, pg_cron), Zod, Vitest, PGlite (offline database tests), Playwright.

## Quick start

```bash
pnpm install
cp .env.example .env.local        # fill in your own values; never commit this file
pnpm db:push                      # apply supabase/migrations and regenerate lib/database.types.ts
pnpm bootstrap --name "گسترش بینش نوین" --slug gbn --email you@example.com --manager "Your Name"
pnpm dev                          # http://localhost:3000
```

Supabase project setup, including auth settings and the Persian email templates, is in [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md).

Optional development data with fictional people that match the Figma mock-ups:

```bash
SEED_PASSWORD=<dev-only password> pnpm seed --org gbn   # creates ali@/sara@/mina@… example.test accounts
```

## Environment variables

| Name | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser + server | Publishable key. Safe in the browser because RLS is enforced. |
| `SUPABASE_SECRET_KEY` | **server only** | Used only for invitations, signed attachment URLs and scripts, always after a permission check |
| `SUPABASE_DB_URL` | local scripts | Session-pooler connection string for `pnpm db:push` |
| `NEXT_PUBLIC_SITE_URL` | server | Base URL for invite and reset links |
| `REQUIRE_MANAGER_MFA` | server | `true` forces TOTP (aal2) for managers. Defaults to on in production and off in development. |
| `SEED_PASSWORD` | local only | Password for the dev seed accounts and e2e tests |

## Tests

| Command | What it covers |
|---|---|
| `pnpm test` | Unit tests (money, Jalali dates, calendar math) plus **all migrations applied to PGlite**. RLS, RPC business rules, recurrence, jobs and file permissions all run offline. |
| `pnpm test:integration` | The live dev project: real Auth/PostgREST/RLS and **true concurrency** (claim race, double review, double payment). It creates and then deletes throwaway organisations. |
| `pnpm test:e2e` | Playwright against `pnpm dev` with seeded data. Run `pnpm exec playwright install chromium` once first. Set `E2E_BASE_URL` to test a preview deploy. |
| `pnpm typecheck` / `pnpm lint` | Types and ESLint |

## Architecture

```
app/(app)/*            pages (Server Components) → lib/services/* (per-request Supabase client, RLS applies)
app/api/v1/*           route() wrapper: request id, CSRF origin check, membership + role from the DB, rate limit, Zod, {data|error, meta}
lib/services/*         one service layer shared by pages and API routes
supabase/migrations/*  schema, RLS, grants, RPCs (multi-table writes are single transactions), jobs
components/ui/*        Figma primitives (board 1:77); components/<module>/* screens and modals
```

- **Authorization in three layers:** the API checks role and membership on every request, RLS covers every exposed table, and the RPCs re-check inside. Invoice tables have **no client grants at all**: managers reach them only through `security definer` functions that check the role.
- **Notifications:** business RPCs write `outbox_events` in the same transaction. `pg_cron` fans them out to inboxes every 30 seconds. Inserts are idempotent (unique recipient + dedupe key) and respect each person's preferences, while critical alerts always go through.
- **Jobs (pg_cron → `app.run_job`):** outbox (30 s), task occurrences (hourly, 90-day horizon), task reminders (hourly), invoice reminders (hourly), weekly digest (Saturday from 08:00 org time), invoice and availability generators (daily), health check (daily). All runs are recorded in `job_runs`, and overlapping runs are skipped.
- **Dates and money:** instants are stored as `timestamptz`, business dates as `date`, and each organisation has an IANA time zone. Monthly recurrence follows **Jalali months**, clamped to the month's last day. Money is stored as `bigint` IRR, and the API takes and returns `amount_toman` as an integer string.

## Security notes

- Invitation-only onboarding. Turn off public sign-ups in Supabase. Deactivation takes effect on the next request because membership is read from the database every time.
- The service-role key never reaches the browser (`server-only` imports).
- Confidential leave reasons are visible only to the employee and managers. The team calendar uses a safe projection.
- Attachments live in a private bucket. Each upload and download goes through a server-signed URL valid for 60 seconds, issued only after `can_access_entity()` passes.
- Security headers (CSP, frame denial, HSTS) are in `next.config.ts`. Mutations are rate limited per user per instance (in memory; see `lib/rate-limit.ts` for the upgrade path).
- The audit log is append-only and records who did what, with sensitive fields redacted.

## Deployment (Vercel preview)

1. Import the GitHub repo into Vercel. Set the environment variables above in Project → Settings, and keep `SUPABASE_SECRET_KEY` server-only.
2. In Supabase Auth → URL Configuration, add the preview URL to Redirect URLs. Set Site URL to your production domain once you have one.
3. Configure custom SMTP before real staff use the app. The built-in sender is rate limited.

## Backups and recovery

- **Database:** Supabase takes daily backups (point-in-time recovery on paid plans). Migrations only roll forward: to undo one, add a new migration and never edit an applied one. Before running migrations in production, take a manual backup and `pnpm db:push --dry-run`.
- **Storage objects** (avatars, attachments) are **not** included in database backups. Export the `avatars` and `attachments` buckets on a schedule (for example with `supabase storage cp -r` or an S3-compatible sync) and test a restore before going live.
- Retention and account-removal policies need a legal and compliance review for your jurisdiction.

## Figma ↔ spec decisions

See *Figma ↔ spec conflicts and resolutions* in `BACKEND_IMPLEMENTATION_PLAN.md`. In short: meetings, leave types and balance, office/remote status and task progress % are implemented as Figma shows them. Auth pages reuse the Figma primitives. The task form has one extra optional field, «تاریخ شروع», so calendar bars can span several days. Archiving replaces hard delete in the task row menu.
