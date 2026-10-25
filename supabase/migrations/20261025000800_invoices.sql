-- 0008 invoices (accounts payable tracker): series, independent invoices, payment confirmations.
-- No table privileges for clients at all; managers read and write through security-definer RPCs
-- that check the role, so employees cannot reach financial rows by any query (spec §3.2, AUTH-02).

create table public.invoice_series (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  title text not null check (char_length(title) between 1 and 200),
  supplier_name text not null check (char_length(supplier_name) between 1 and 200),
  description text not null default '' check (char_length(description) <= 2000),
  amount_irr bigint not null check (amount_irr >= 0),
  recurrence_type text not null check (recurrence_type in ('weekly', 'monthly', 'interval_days')),
  recurrence_interval integer not null default 1 check (recurrence_interval between 1 and 365),
  first_due_date date not null,
  end_date date,
  timezone text not null,
  reminder_enabled boolean not null default true,
  is_active boolean not null default true,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  check (end_date is null or end_date >= first_due_date)
);
create trigger invoice_series_updated_at before update on public.invoice_series for each row execute function app.set_updated_at();
create trigger invoice_series_audit after insert or update on public.invoice_series for each row execute function app.audit_row();

create table public.invoice_counters (
  organization_id uuid not null references public.organizations (id),
  jalali_year integer not null,
  last_number integer not null default 0,
  primary key (organization_id, jalali_year)
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  series_id uuid,
  title text not null check (char_length(title) between 1 and 200),
  supplier_name text not null check (char_length(supplier_name) between 1 and 200),
  description text not null default '' check (char_length(description) <= 2000),
  invoice_reference text,
  amount_irr bigint not null check (amount_irr >= 0),
  currency text not null default 'IRR' check (currency = 'IRR'),
  due_date date not null,
  issue_date date,
  payment_state text not null default 'unpaid' check (payment_state in ('unpaid', 'paid', 'cancelled')),
  paid_at timestamptz,
  generation_key text,
  reminder_enabled boolean not null default true,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, invoice_reference),
  unique (series_id, generation_key),
  foreign key (organization_id, series_id) references public.invoice_series (organization_id, id),
  check ((payment_state = 'paid') = (paid_at is not null)),
  check ((series_id is null) = (generation_key is null))
);
create index invoices_org_due_idx on public.invoices (organization_id, due_date, payment_state);
create trigger invoices_updated_at before update on public.invoices for each row execute function app.set_updated_at();
create trigger invoices_audit after insert or update on public.invoices for each row execute function app.audit_row('description');

create table public.payment_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  invoice_id uuid not null,
  amount_irr bigint not null check (amount_irr >= 0),
  paid_at timestamptz not null,
  method text not null check (method in ('bank_transfer', 'card', 'cash', 'cheque', 'other')),
  transaction_reference text check (char_length(transaction_reference) <= 100),
  notes text check (char_length(notes) <= 1000),
  confirmed_by uuid not null references public.profiles (id),
  idempotency_key text check (char_length(idempotency_key) <= 100),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id),
  void_reason text check (char_length(void_reason) <= 1000),
  created_at timestamptz not null default now(),
  foreign key (organization_id, invoice_id) references public.invoices (organization_id, id),
  check ((voided_at is null) = (void_reason is null))
);
-- V1: exactly one active (non-voided) full settlement per invoice; retries with the same key are idempotent.
create unique index payment_records_one_active on public.payment_records (invoice_id) where voided_at is null;
create unique index payment_records_idempotency on public.payment_records (organization_id, idempotency_key) where idempotency_key is not null;
create trigger payment_records_audit after insert or update on public.payment_records
  for each row execute function app.audit_row('transaction_reference,notes');

-- A paid invoice must always have an active settlement record.
create or replace function app.invoice_paid_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.payment_state = 'paid' and not exists (select 1 from public.payment_records p where p.invoice_id = new.id and p.voided_at is null) then
    raise exception using errcode = '23514', message = 'paid invoice without settlement record';
  end if;
  return new;
end;
$$;
create trigger invoices_paid_guard before update of payment_state on public.invoices for each row execute function app.invoice_paid_guard();

-- Auto reference «۱۴۰۵/۰۰۱»: per organisation per Jalali year of the due date.
create or replace function app.assign_invoice_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  jy integer := (app.to_jalali(new.due_date)).jy;
  n integer;
begin
  if new.invoice_reference is not null then return new; end if;
  insert into public.invoice_counters (organization_id, jalali_year, last_number) values (new.organization_id, jy, 1)
    on conflict (organization_id, jalali_year) do update set last_number = public.invoice_counters.last_number + 1
    returning last_number into n;
  new.invoice_reference := jy || '/' || lpad(n::text, 3, '0');
  return new;
end;
$$;
create trigger invoices_reference before insert on public.invoices for each row execute function app.assign_invoice_reference();

alter table public.invoice_series enable row level security;
alter table public.invoices enable row level security;
alter table public.payment_records enable row level security;
alter table public.invoice_counters enable row level security;
revoke all on public.invoice_series, public.invoices, public.payment_records, public.invoice_counters from anon, authenticated;

-- ── Helpers ──

create or replace function app.manager_org()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org uuid;
begin
  select m.organization_id into org from public.organization_memberships m
    where m.user_id = auth.uid() and m.status = 'active' and m.role = 'manager' order by m.created_at limit 1;
  if org is null then perform app.fail('FORBIDDEN'); end if;
  return org;
end;
$$;
revoke all on function app.manager_org() from public;
grant execute on function app.manager_org() to authenticated;

create or replace function app.parse_amount(v text)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
begin
  if v is null or v !~ '^\d{1,18}$' then perform app.fail('INVALID_AMOUNT'); end if;
  return v::bigint;
end;
$$;

create or replace function app.generate_invoice_occurrences(p_series uuid default null, p_horizon_days integer default 90, p_from date default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  total integer := 0;
  n integer;
  last_date date;
begin
  for s in
    select se.*, o.week_start from public.invoice_series se join public.organizations o on o.id = se.organization_id
    where se.is_active and (p_series is null or se.id = p_series)
  loop
    select max(due_date) into last_date from public.invoices where series_id = s.id;
    insert into public.invoices (organization_id, series_id, title, supplier_name, description, amount_irr, due_date, generation_key, reminder_enabled, created_by)
    select s.organization_id, s.id, s.title, s.supplier_name, s.description, s.amount_irr, d, to_char(d, 'YYYY-MM-DD'), s.reminder_enabled, s.created_by
    from app.recurrence_dates(s.first_due_date, s.recurrence_type, s.recurrence_interval, null, s.end_date,
                              coalesce(p_from, last_date + 1, s.first_due_date),
                              (now() at time zone s.timezone)::date + p_horizon_days, s.week_start) d
    order by d
    on conflict (series_id, generation_key) do nothing;
    get diagnostics n = row_count;
    total := total + n;
  end loop;
  return total;
end;
$$;
revoke all on function app.generate_invoice_occurrences(uuid, integer, date) from public;

-- ── RPCs (manager only) ──

create or replace function public.create_invoice(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.manager_org();
  inv public.invoices;
begin
  insert into public.invoices (organization_id, title, supplier_name, description, amount_irr, due_date, issue_date, reminder_enabled, created_by)
  values (org, p ->> 'title', p ->> 'supplier_name', coalesce(p ->> 'description', ''), app.parse_amount(p ->> 'amount_irr'),
          (p ->> 'due_date')::date, (p ->> 'issue_date')::date, coalesce((p ->> 'reminder_enabled')::boolean, true), auth.uid())
  returning * into inv;
  return jsonb_build_object('invoice_id', inv.id, 'invoice_reference', inv.invoice_reference);
end;
$$;

create or replace function public.create_invoice_series(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.manager_org();
  s public.invoice_series;
  n integer;
  first_inv uuid;
begin
  insert into public.invoice_series (organization_id, title, supplier_name, description, amount_irr, recurrence_type, recurrence_interval,
                                     first_due_date, end_date, timezone, reminder_enabled, created_by)
  values (org, p ->> 'title', p ->> 'supplier_name', coalesce(p ->> 'description', ''), app.parse_amount(p ->> 'amount_irr'),
          coalesce(p ->> 'recurrence_type', 'monthly'), coalesce((p ->> 'recurrence_interval')::int, 1),
          (p ->> 'first_due_date')::date, (p ->> 'end_date')::date,
          (select timezone from public.organizations where id = org), coalesce((p ->> 'reminder_enabled')::boolean, true), auth.uid())
  returning * into s;
  n := app.generate_invoice_occurrences(s.id, 90, s.first_due_date);
  select id into first_inv from public.invoices where series_id = s.id order by due_date limit 1;
  return jsonb_build_object('series_id', s.id, 'invoice_id', first_inv, 'generated', n);
end;
$$;

create or replace function public.update_invoice(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.manager_org();
  inv public.invoices;
begin
  select * into inv from public.invoices where id = p_id and organization_id = org for update;
  if inv.id is null then perform app.fail('NOT_FOUND'); end if;
  if inv.payment_state = 'paid' and p ?| array['amount_irr', 'due_date', 'supplier_name'] then perform app.fail('INVOICE_ALREADY_PAID'); end if;
  if inv.payment_state = 'cancelled' then perform app.fail('INVOICE_CANCELLED'); end if;
  if p ->> 'payment_state' = 'cancelled' then
    if inv.payment_state = 'paid' then perform app.fail('INVOICE_ALREADY_PAID'); end if;
    update public.invoices set payment_state = 'cancelled' where id = inv.id;
    return jsonb_build_object('invoice_id', inv.id, 'payment_state', 'cancelled');
  end if;
  update public.invoices set
    title = coalesce(p ->> 'title', title),
    supplier_name = coalesce(p ->> 'supplier_name', supplier_name),
    description = coalesce(p ->> 'description', description),
    amount_irr = case when p ? 'amount_irr' then app.parse_amount(p ->> 'amount_irr') else amount_irr end,
    due_date = coalesce((p ->> 'due_date')::date, due_date),
    issue_date = case when p ? 'issue_date' then (p ->> 'issue_date')::date else issue_date end,
    reminder_enabled = coalesce((p ->> 'reminder_enabled')::boolean, reminder_enabled)
  where id = inv.id;
  return jsonb_build_object('invoice_id', inv.id);
end;
$$;

-- Series edits apply to future unpaid invoices only; paid history is never touched (INV-03 / §6.5.6).
create or replace function public.update_invoice_series(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.manager_org();
  s public.invoice_series;
  today date;
  schedule_changed boolean := p ?| array['first_due_date', 'recurrence_type', 'recurrence_interval', 'end_date'];
  affected integer;
begin
  select * into s from public.invoice_series where id = p_id and organization_id = org for update;
  if s.id is null then perform app.fail('NOT_FOUND'); end if;
  today := (now() at time zone s.timezone)::date;

  if p ? 'is_active' and not (p ->> 'is_active')::boolean then
    update public.invoice_series set is_active = false where id = s.id;
    update public.invoices set payment_state = 'cancelled' where series_id = s.id and payment_state = 'unpaid' and due_date > today;
    return jsonb_build_object('series_id', s.id, 'is_active', false);
  end if;

  update public.invoice_series set
    title = coalesce(p ->> 'title', title),
    supplier_name = coalesce(p ->> 'supplier_name', supplier_name),
    description = coalesce(p ->> 'description', description),
    amount_irr = case when p ? 'amount_irr' then app.parse_amount(p ->> 'amount_irr') else amount_irr end,
    recurrence_type = coalesce(p ->> 'recurrence_type', recurrence_type),
    recurrence_interval = coalesce((p ->> 'recurrence_interval')::int, recurrence_interval),
    first_due_date = coalesce((p ->> 'first_due_date')::date, first_due_date),
    end_date = case when p ? 'end_date' then (p ->> 'end_date')::date else end_date end,
    reminder_enabled = coalesce((p ->> 'reminder_enabled')::boolean, reminder_enabled)
  where id = s.id returning * into s;

  if schedule_changed then
    delete from public.invoices where series_id = s.id and payment_state = 'unpaid' and due_date >= today;
    perform app.generate_invoice_occurrences(s.id, 90, greatest(today, s.first_due_date));
  else
    update public.invoices set title = s.title, supplier_name = s.supplier_name, description = s.description,
      amount_irr = s.amount_irr, reminder_enabled = s.reminder_enabled
    where series_id = s.id and payment_state = 'unpaid' and due_date >= today;
  end if;
  get diagnostics affected = row_count;
  return jsonb_build_object('series_id', s.id, 'future_invoices_updated', affected);
end;
$$;

-- Record a verified full payment: payment row + invoice state in one transaction; idempotent by key.
create or replace function public.mark_invoice_paid(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.manager_org();
  inv public.invoices;
  existing public.payment_records;
  pay public.payment_records;
  amount bigint := app.parse_amount(p ->> 'amount_irr');
  key text := nullif(p ->> 'idempotency_key', '');
begin
  select * into inv from public.invoices where id = p_id and organization_id = org for update;
  if inv.id is null then perform app.fail('NOT_FOUND'); end if;

  if key is not null then
    select * into existing from public.payment_records where organization_id = org and idempotency_key = key;
    if existing.id is not null then
      if existing.invoice_id <> inv.id then perform app.fail('CONFLICT'); end if;
      return jsonb_build_object('payment_id', existing.id, 'invoice_id', inv.id, 'payment_state', inv.payment_state, 'idempotent_replay', true);
    end if;
  end if;
  if inv.payment_state = 'paid' then perform app.fail('INVOICE_ALREADY_PAID'); end if;
  if inv.payment_state = 'cancelled' then perform app.fail('INVOICE_CANCELLED'); end if;
  if amount <> inv.amount_irr then perform app.fail('AMOUNT_MISMATCH', jsonb_build_object('expected_irr', inv.amount_irr::text)); end if;

  insert into public.payment_records (organization_id, invoice_id, amount_irr, paid_at, method, transaction_reference, notes, confirmed_by, idempotency_key)
  values (org, inv.id, amount, coalesce((p ->> 'paid_at')::timestamptz, now()), coalesce(p ->> 'method', 'bank_transfer'),
          nullif(p ->> 'transaction_reference', ''), nullif(p ->> 'notes', ''), auth.uid(), key)
  returning * into pay;
  update public.invoices set payment_state = 'paid', paid_at = pay.paid_at where id = inv.id;

  perform app.emit(org, 'invoice.paid', 'invoice', inv.id, array(select x from unnest(app.org_managers(org)) x where x <> auth.uid()), 'invoice.paid',
    jsonb_build_object('title', inv.title, 'amount_irr', inv.amount_irr::text, 'supplier_name', inv.supplier_name), 'general', 'invoice.paid:' || pay.id);
  return jsonb_build_object('payment_id', pay.id, 'invoice_id', inv.id, 'payment_state', 'paid', 'idempotent_replay', false);
end;
$$;

-- Controlled, audited correction: void the active settlement (reason required) and reopen the invoice.
create or replace function public.void_payment(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.manager_org();
  inv public.invoices;
begin
  if char_length(trim(coalesce(p_reason, ''))) = 0 then perform app.fail('VALIDATION_FAILED', '{"field":"reason"}'); end if;
  select * into inv from public.invoices where id = p_id and organization_id = org for update;
  if inv.id is null then perform app.fail('NOT_FOUND'); end if;
  if inv.payment_state <> 'paid' then perform app.fail('INVOICE_NOT_PAID'); end if;
  update public.payment_records set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
    where invoice_id = inv.id and voided_at is null;
  update public.invoices set payment_state = 'unpaid', paid_at = null where id = inv.id;
  return jsonb_build_object('invoice_id', inv.id, 'payment_state', 'unpaid');
end;
$$;

-- Derived display state: paid | cancelled | overdue | due_soon | unpaid (never stored).
create or replace function app.invoice_display_state(inv public.invoices, today date, lead_days integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when inv.payment_state <> 'unpaid' then inv.payment_state
    when inv.due_date < today then 'overdue'
    when inv.due_date <= today + lead_days then 'due_soon'
    else 'unpaid'
  end;
$$;

create or replace function app.invoice_lead_days(org uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select invoice_reminder_days from public.member_preferences where organization_id = org and user_id = auth.uid()), 3);
$$;

create or replace function public.invoice_list(
  p_state text default null, p_from date default null, p_to date default null, p_q text default null,
  p_limit integer default 10, p_offset integer default 0
)
returns table (
  id uuid, series_id uuid, title text, supplier_name text, invoice_reference text, amount_irr text, due_date date,
  payment_state text, display_state text, recurrence_type text, paid_at timestamptz, total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org uuid := app.manager_org();
  today date := (select (now() at time zone o.timezone)::date from public.organizations o where o.id = org);
  lead integer := app.invoice_lead_days(org);
begin
  return query
  select i.id, i.series_id, i.title, i.supplier_name, i.invoice_reference, i.amount_irr::text, i.due_date, i.payment_state,
         app.invoice_display_state(i, today, lead), s.recurrence_type, i.paid_at, count(*) over ()
  from public.invoices i
  left join public.invoice_series s on s.id = i.series_id
  where i.organization_id = org
    and (p_from is null or i.due_date >= p_from)
    and (p_to is null or i.due_date <= p_to)
    and (p_q is null or i.title ilike '%' || replace(replace(p_q, '%', '\%'), '_', '\_') || '%'
                     or i.supplier_name ilike '%' || replace(replace(p_q, '%', '\%'), '_', '\_') || '%'
                     or i.invoice_reference ilike '%' || p_q || '%')
    and (p_state is null
         or (p_state in ('paid', 'cancelled') and i.payment_state = p_state)
         or (p_state = 'unpaid' and i.payment_state = 'unpaid')
         or (p_state in ('overdue', 'due_soon') and app.invoice_display_state(i, today, lead) = p_state))
    and (p_state = 'cancelled' or i.payment_state <> 'cancelled')
  order by (i.payment_state = 'unpaid' and i.due_date < today) desc, i.payment_state = 'paid', i.due_date, i.id
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
end;
$$;

-- KPI cards: amounts as text (bigint-safe), counts as integers.
create or replace function public.invoice_summary(p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org uuid := app.manager_org();
  today date := (select (now() at time zone o.timezone)::date from public.organizations o where o.id = org);
  lead integer := app.invoice_lead_days(org);
  result jsonb;
begin
  select jsonb_build_object(
    'unpaid_irr', coalesce(sum(amount_irr) filter (where payment_state = 'unpaid'), 0)::text,
    'unpaid_count', count(*) filter (where payment_state = 'unpaid'),
    'paid_irr', coalesce(sum(amount_irr) filter (where payment_state = 'paid'), 0)::text,
    'paid_count', count(*) filter (where payment_state = 'paid'),
    'due_soon_irr', coalesce(sum(amount_irr) filter (where app.invoice_display_state(i, today, lead) = 'due_soon'), 0)::text,
    'due_soon_count', count(*) filter (where app.invoice_display_state(i, today, lead) = 'due_soon'),
    'overdue_irr', coalesce(sum(amount_irr) filter (where app.invoice_display_state(i, today, lead) = 'overdue'), 0)::text,
    'overdue_count', count(*) filter (where app.invoice_display_state(i, today, lead) = 'overdue'),
    'lead_days', lead)
  into result
  from public.invoices i
  where i.organization_id = org and i.payment_state <> 'cancelled'
    and (p_from is null or i.due_date >= p_from) and (p_to is null or i.due_date <= p_to);
  return result;
end;
$$;

create or replace function public.invoice_detail(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org uuid := app.manager_org();
  today date := (select (now() at time zone o.timezone)::date from public.organizations o where o.id = org);
  inv public.invoices;
  result jsonb;
begin
  select * into inv from public.invoices where id = p_id and organization_id = org;
  if inv.id is null then perform app.fail('NOT_FOUND'); end if;
  select jsonb_build_object(
    'id', inv.id, 'series_id', inv.series_id, 'title', inv.title, 'supplier_name', inv.supplier_name, 'description', inv.description,
    'invoice_reference', inv.invoice_reference, 'amount_irr', inv.amount_irr::text, 'due_date', inv.due_date, 'issue_date', inv.issue_date,
    'payment_state', inv.payment_state, 'display_state', app.invoice_display_state(inv, today, app.invoice_lead_days(org)),
    'days_overdue', case when inv.payment_state = 'unpaid' and inv.due_date < today then today - inv.due_date else 0 end,
    'paid_at', inv.paid_at, 'reminder_enabled', inv.reminder_enabled, 'created_at', inv.created_at,
    'created_by_name', (select full_name from public.profiles where id = inv.created_by),
    'series', (select jsonb_build_object('recurrence_type', s.recurrence_type, 'recurrence_interval', s.recurrence_interval,
                                         'first_due_date', s.first_due_date, 'end_date', s.end_date, 'is_active', s.is_active)
               from public.invoice_series s where s.id = inv.series_id),
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pr.id, 'amount_irr', pr.amount_irr::text, 'paid_at', pr.paid_at, 'method', pr.method,
        'transaction_reference', pr.transaction_reference, 'notes', pr.notes,
        'confirmed_by_name', (select full_name from public.profiles where id = pr.confirmed_by), 'created_at', pr.created_at,
        'voided_at', pr.voided_at, 'void_reason', pr.void_reason) order by pr.created_at desc)
      from public.payment_records pr where pr.invoice_id = inv.id), '[]'::jsonb),
    'organization', (select jsonb_build_object('name', o.name, 'address', o.address, 'phone', o.phone, 'registration_code', o.registration_code)
                     from public.organizations o where o.id = org))
  into result;
  return result;
end;
$$;

create or replace function public.invoice_suppliers()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select distinct supplier_name from public.invoices where organization_id = app.manager_org() order by 1 limit 200;
$$;

revoke all on function public.create_invoice(jsonb), public.create_invoice_series(jsonb), public.update_invoice(uuid, jsonb),
  public.update_invoice_series(uuid, jsonb), public.mark_invoice_paid(uuid, jsonb), public.void_payment(uuid, text),
  public.invoice_list(text, date, date, text, integer, integer), public.invoice_summary(date, date), public.invoice_detail(uuid),
  public.invoice_suppliers() from public, anon;
grant execute on function public.create_invoice(jsonb), public.create_invoice_series(jsonb), public.update_invoice(uuid, jsonb),
  public.update_invoice_series(uuid, jsonb), public.mark_invoice_paid(uuid, jsonb), public.void_payment(uuid, text),
  public.invoice_list(text, date, date, text, integer, integer), public.invoice_summary(date, date), public.invoice_detail(uuid),
  public.invoice_suppliers() to authenticated;
