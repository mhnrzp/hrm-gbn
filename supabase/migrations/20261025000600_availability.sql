-- 0006 declared availability ("زمان آزاد"): one-off or weekly rules expanded into bounded occurrences.
-- Undeclared time is "unknown", never assumed free.

create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null references public.profiles (id),
  start_date date not null,
  start_time time not null,
  end_time time not null,                      -- end_time <= start_time means the slot ends the next day
  timezone text not null,
  recurrence_type text not null default 'none' check (recurrence_type in ('none', 'weekly')),
  recurrence_interval integer not null default 1 check (recurrence_interval between 1 and 52),
  weekdays smallint[] check (weekdays <@ '{0,1,2,3,4,5,6}'::smallint[]),
  end_date date,
  note text not null default '' check (char_length(note) <= 500),
  created_by uuid not null references public.profiles (id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  check (start_time <> end_time),
  check (end_date is null or end_date >= start_date),
  foreign key (organization_id, employee_id) references public.organization_memberships (organization_id, user_id)
);
create trigger availability_rules_updated_at before update on public.availability_rules for each row execute function app.set_updated_at();

create table public.availability_occurrences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  rule_id uuid not null,
  employee_id uuid not null references public.profiles (id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  generation_key text not null,
  created_at timestamptz not null default now(),
  unique (rule_id, generation_key),
  check (end_at > start_at),
  foreign key (organization_id, rule_id) references public.availability_rules (organization_id, id)
);
create index availability_occ_idx on public.availability_occurrences (organization_id, employee_id, start_at, end_at);

create or replace function app.generate_availability_occurrences(p_rule uuid default null, p_horizon_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  total integer := 0;
  n integer;
begin
  for r in
    select ar.*, o.week_start from public.availability_rules ar join public.organizations o on o.id = ar.organization_id
    where ar.is_active and (p_rule is null or ar.id = p_rule)
  loop
    insert into public.availability_occurrences (organization_id, rule_id, employee_id, start_at, end_at, generation_key)
    select r.organization_id, r.id, r.employee_id,
           (d + r.start_time) at time zone r.timezone,
           ((d + case when r.end_time <= r.start_time then 1 else 0 end) + r.end_time) at time zone r.timezone,
           to_char(d, 'YYYY-MM-DD')
    from app.recurrence_dates(r.start_date, r.recurrence_type, r.recurrence_interval, r.weekdays, r.end_date,
                              greatest(r.start_date, (now() at time zone r.timezone)::date - 1),
                              (now() at time zone r.timezone)::date + p_horizon_days, r.week_start) d
    on conflict (rule_id, generation_key) do nothing;
    get diagnostics n = row_count;
    total := total + n;
  end loop;
  return total;
end;
$$;
revoke all on function app.generate_availability_occurrences(uuid, integer) from public;

alter table public.availability_rules enable row level security;
alter table public.availability_occurrences enable row level security;
revoke all on public.availability_rules, public.availability_occurrences from anon, authenticated;
grant select on public.availability_rules, public.availability_occurrences to authenticated;
-- Declared availability is team-public (spec: permitted public team schedule).
create policy availability_rules_select on public.availability_rules for select to authenticated using (app.is_active_member(organization_id));
create policy availability_occ_select on public.availability_occurrences for select to authenticated using (app.is_active_member(organization_id));

-- Create or update a rule (own, or any member's for managers) and (re)generate future occurrences.
create or replace function public.save_availability(p jsonb, p_rule uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  org uuid;
  emp uuid;
  tz text;
  rule public.availability_rules;
  n integer;
begin
  if p_rule is not null then
    select * into rule from public.availability_rules where id = p_rule for update;
    if rule.id is null or not (rule.employee_id = me or app.is_manager(rule.organization_id)) then perform app.fail('NOT_FOUND'); end if;
    org := rule.organization_id;
    emp := rule.employee_id;
  else
    org := (p ->> 'organization_id')::uuid;
    emp := coalesce((p ->> 'employee_id')::uuid, me);
    if not app.is_active_member(org) then perform app.fail('FORBIDDEN'); end if;
    if emp <> me and not app.is_manager(org) then perform app.fail('FORBIDDEN'); end if;
    if not app.is_active_member_user(org, emp) then perform app.fail('MEMBER_INACTIVE'); end if;
  end if;
  select timezone into tz from public.organizations where id = org;

  if rule.id is null then
    insert into public.availability_rules (organization_id, employee_id, start_date, start_time, end_time, timezone, recurrence_type,
                                           recurrence_interval, weekdays, end_date, note, created_by)
    values (org, emp, (p ->> 'start_date')::date, (p ->> 'start_time')::time, (p ->> 'end_time')::time, tz,
            coalesce(p ->> 'recurrence_type', 'none'), coalesce((p ->> 'recurrence_interval')::int, 1),
            case when jsonb_typeof(p -> 'weekdays') = 'array' then array(select jsonb_array_elements_text(p -> 'weekdays')::smallint) end,
            (p ->> 'end_date')::date, coalesce(p ->> 'note', ''), me)
    returning * into rule;
  else
    update public.availability_rules set
      start_date = coalesce((p ->> 'start_date')::date, start_date),
      start_time = coalesce((p ->> 'start_time')::time, start_time),
      end_time = coalesce((p ->> 'end_time')::time, end_time),
      recurrence_type = coalesce(p ->> 'recurrence_type', recurrence_type),
      weekdays = case when jsonb_typeof(p -> 'weekdays') = 'array' then array(select jsonb_array_elements_text(p -> 'weekdays')::smallint)
                      when p ? 'weekdays' then null else weekdays end,
      end_date = case when p ? 'end_date' then (p ->> 'end_date')::date else end_date end,
      note = coalesce(p ->> 'note', note)
    where id = rule.id
    returning * into rule;
    -- Future instances follow the new rule; past ones stay as history.
    delete from public.availability_occurrences where rule_id = rule.id and start_at > now();
  end if;

  n := app.generate_availability_occurrences(rule.id, 90);
  return jsonb_build_object('rule_id', rule.id, 'occurrences', n);
end;
$$;

create or replace function public.delete_availability(p_rule uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule public.availability_rules;
begin
  select * into rule from public.availability_rules where id = p_rule for update;
  if rule.id is null or not (rule.employee_id = auth.uid() or app.is_manager(rule.organization_id)) then perform app.fail('NOT_FOUND'); end if;
  update public.availability_rules set is_active = false where id = rule.id;
  delete from public.availability_occurrences where rule_id = rule.id and start_at > now();
end;
$$;

revoke all on function public.save_availability(jsonb, uuid), public.delete_availability(uuid) from public, anon;
grant execute on function public.save_availability(jsonb, uuid), public.delete_availability(uuid) to authenticated;
