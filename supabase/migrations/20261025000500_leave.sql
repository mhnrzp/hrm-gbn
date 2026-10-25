-- 0005 leave: types, requests (confidential reasons), balance, review workflow, task-conflict detection.

create table public.leave_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  code text not null check (code ~ '^[a-z_]{2,30}$'),
  name text not null check (char_length(name) between 1 and 60),
  deducts_balance boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id)
);

create or replace function app.seed_leave_types()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.leave_types (organization_id, code, name, deducts_balance) values
    (new.id, 'annual', 'استحقاقی', true),
    (new.id, 'sick', 'استعلاجی', false),
    (new.id, 'unpaid', 'بدون حقوق', false)
  on conflict do nothing;
  return new;
end;
$$;
create trigger organizations_seed_leave_types after insert on public.organizations
  for each row execute function app.seed_leave_types();
insert into public.leave_types (organization_id, code, name, deducts_balance)
  select o.id, v.code, v.name, v.deducts from public.organizations o
  cross join (values ('annual', 'استحقاقی', true), ('sick', 'استعلاجی', false), ('unpaid', 'بدون حقوق', false)) v(code, name, deducts)
  on conflict do nothing;

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null references public.profiles (id),
  leave_type_id uuid not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default true,
  days_count numeric(5, 1) not null default 0,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reason_private text not null check (char_length(reason_private) between 1 and 1000),
  manager_comment text check (char_length(manager_comment) <= 1000),
  created_by uuid not null references public.profiles (id),
  is_manager_override boolean not null default false,
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  check (end_at > start_at),
  check (end_at - start_at <= interval '366 days'),
  foreign key (organization_id, employee_id) references public.organization_memberships (organization_id, user_id),
  foreign key (organization_id, leave_type_id) references public.leave_types (organization_id, id),
  -- An employee never has two approved absences at the same time.
  constraint leave_requests_no_overlap exclude using gist (employee_id with =, tstzrange(start_at, end_at) with &&) where (status = 'approved')
);
create index leave_requests_org_time_idx on public.leave_requests (organization_id, employee_id, start_at, end_at);
create index leave_requests_pending_idx on public.leave_requests (organization_id) where status = 'pending';
create trigger leave_requests_updated_at before update on public.leave_requests for each row execute function app.set_updated_at();
create trigger leave_requests_audit after insert or update on public.leave_requests
  for each row execute function app.audit_row('reason_private,manager_comment');

-- Working days between two org-local dates (inclusive), excluding the organisation's weekend days.
create or replace function app.leave_days(org uuid, from_date date, to_date date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::numeric
  from generate_series(from_date::timestamp, to_date::timestamp, interval '1 day') d,
       public.organizations o
  where o.id = org and extract(dow from d)::smallint <> all (o.weekend_days);
$$;

-- Open task occurrences of an employee that fall into a leave window.
create or replace function app.leave_task_conflicts(emp uuid, p_start timestamptz, p_end timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'occurrence_id', o.id, 'task_id', t.id, 'title', t.title, 'due_at', o.due_at, 'scheduled_start_at', o.scheduled_start_at,
    'kind', case when o.due_at >= p_start and o.due_at < p_end then 'deadline_during_leave' else 'scheduled_overlap' end
  ) order by o.due_at), '[]'::jsonb)
  from public.task_occurrences o
  join public.tasks t on t.id = o.task_id
  where o.status in ('todo', 'in_progress')
    and (o.claimed_by = emp or exists (select 1 from public.task_occurrence_assignees a where a.occurrence_id = o.id and a.user_id = emp))
    and ((o.due_at >= p_start and o.due_at < p_end)
         or (o.scheduled_start_at is not null and tstzrange(o.scheduled_start_at, o.due_at, '[]') && tstzrange(p_start, p_end)));
$$;

-- Real implementation of the hook used by create_task: assignees with approved leave in the task window.
create or replace function app.assignment_warnings(org uuid, users uuid[], start_at timestamptz, due_at timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', l.employee_id, 'full_name', p.full_name, 'leave_id', l.id,
                                               'start_at', l.start_at, 'end_at', l.end_at, 'kind', 'approved_leave')), '[]'::jsonb)
  from public.leave_requests l join public.profiles p on p.id = l.employee_id
  where l.organization_id = org and l.status = 'approved' and l.employee_id = any (users)
    and tstzrange(l.start_at, l.end_at) && tstzrange(least(start_at, due_at), due_at, '[]');
$$;

-- Leave balance for a member in a Jalali year (self or manager only).
create or replace function public.leave_balance(p_user uuid, p_jalali_year integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m public.organization_memberships;
  o public.organizations;
  jy integer;
  y_start date;
  y_end date;
  quota numeric;
  used numeric;
  pending numeric;
begin
  select mm.* into m from public.organization_memberships mm
    where mm.user_id = p_user and mm.status in ('active', 'invited')
      and (p_user = auth.uid() or app.is_manager(mm.organization_id))
    order by mm.created_at limit 1;
  if m.id is null then perform app.fail('NOT_FOUND'); end if;
  select * into o from public.organizations where id = m.organization_id;
  jy := coalesce(p_jalali_year, (app.to_jalali((now() at time zone o.timezone)::date)).jy);
  y_start := app.from_jalali(jy, 1, 1);
  y_end := app.from_jalali(jy + 1, 1, 1);
  quota := coalesce(m.annual_leave_quota_days, o.default_leave_quota_days);
  select coalesce(sum(l.days_count) filter (where l.status = 'approved'), 0),
         coalesce(sum(l.days_count) filter (where l.status = 'pending'), 0)
    into used, pending
    from public.leave_requests l join public.leave_types lt on lt.id = l.leave_type_id
    where l.employee_id = p_user and l.organization_id = m.organization_id and lt.deducts_balance
      and (l.start_at at time zone o.timezone)::date >= y_start and (l.start_at at time zone o.timezone)::date < y_end;
  return jsonb_build_object('user_id', p_user, 'jalali_year', jy, 'quota_days', quota, 'used_days', used,
                            'pending_days', pending, 'remaining_days', quota - used);
end;
$$;

alter table public.leave_types enable row level security;
alter table public.leave_requests enable row level security;
revoke all on public.leave_types, public.leave_requests from anon, authenticated;
grant select on public.leave_types to authenticated;
create policy leave_types_select on public.leave_types for select to authenticated using (app.is_active_member(organization_id));
-- Confidential reasons: only the employee and managers can read request rows. Co-workers use calendar_feed().
grant select on public.leave_requests to authenticated;
create policy leave_requests_select on public.leave_requests for select to authenticated
  using ((employee_id = (select auth.uid()) and app.is_active_member(organization_id)) or app.is_manager(organization_id));

-- ── RPCs ──

-- Submit leave. Employees file for themselves (pending). Managers may file for anyone; with
-- p ->> 'approve_now' = true it is recorded as an explicit, audited manager override.
create or replace function public.submit_leave(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  org uuid := (p ->> 'organization_id')::uuid;
  emp uuid := coalesce((p ->> 'employee_id')::uuid, auth.uid());
  is_mgr boolean;
  approve_now boolean := coalesce((p ->> 'approve_now')::boolean, false);
  tz text;
  from_date date := (p ->> 'start_date')::date;
  to_date date := (p ->> 'end_date')::date;
  s timestamptz;
  e timestamptz;
  lt public.leave_types;
  req public.leave_requests;
  conflicts jsonb;
  overlapping integer;
  emp_name text;
begin
  if not app.is_active_member(org) then perform app.fail('FORBIDDEN'); end if;
  is_mgr := app.is_manager(org);
  if emp <> me and not is_mgr then perform app.fail('FORBIDDEN'); end if;
  if approve_now and not is_mgr then perform app.fail('FORBIDDEN'); end if;
  if not app.is_active_member_user(org, emp) then perform app.fail('MEMBER_INACTIVE'); end if;
  if from_date is null or to_date is null or to_date < from_date then perform app.fail('VALIDATION_FAILED', '{"field":"end_date"}'); end if;

  select * into lt from public.leave_types where organization_id = org and id = (p ->> 'leave_type_id')::uuid and is_active;
  if lt.id is null then perform app.fail('VALIDATION_FAILED', '{"field":"leave_type_id"}'); end if;

  select timezone into tz from public.organizations where id = org;
  if coalesce((p ->> 'all_day')::boolean, true) then
    s := from_date::timestamp at time zone tz;
    e := (to_date + 1)::timestamp at time zone tz;
  else
    s := (from_date + (p ->> 'start_time')::time) at time zone tz;
    e := (to_date + (p ->> 'end_time')::time) at time zone tz;
    if e <= s then perform app.fail('VALIDATION_FAILED', '{"field":"end_time"}'); end if;
  end if;

  select count(*) into overlapping from public.leave_requests
    where employee_id = emp and status in ('approved', 'pending') and tstzrange(start_at, end_at) && tstzrange(s, e);

  begin
    insert into public.leave_requests (organization_id, employee_id, leave_type_id, start_at, end_at, all_day, days_count, status,
                                       reason_private, created_by, is_manager_override, reviewed_by, reviewed_at)
    values (org, emp, lt.id, s, e, coalesce((p ->> 'all_day')::boolean, true),
            case when coalesce((p ->> 'all_day')::boolean, true) then app.leave_days(org, from_date, to_date)
                 else round(extract(epoch from (e - s)) / 3600 / 8, 1) end,
            case when approve_now then 'approved' else 'pending' end,
            trim(p ->> 'reason'), me, approve_now,
            case when approve_now then me end, case when approve_now then now() end)
    returning * into req;
  exception when exclusion_violation then
    perform app.fail('LEAVE_OVERLAP');
  end;

  conflicts := app.leave_task_conflicts(emp, s, e);
  select full_name into emp_name from public.profiles where id = emp;

  if approve_now then
    perform app.emit(org, 'leave.approved', 'leave_request', req.id, array_remove(array[emp], me), 'leave.approved',
      jsonb_build_object('employee_name', emp_name, 'start_at', s, 'end_at', e, 'days', req.days_count), 'critical', 'leave.approved:' || req.id);
  else
    perform app.emit(org, 'leave.requested', 'leave_request', req.id, array(select x from unnest(app.org_managers(org)) x where x <> emp), 'leave.requested',
      jsonb_build_object('employee_name', emp_name, 'start_at', s, 'end_at', e, 'days', req.days_count,
                         'conflicting_task_count', jsonb_array_length(conflicts)), 'leave_requests', 'leave.requested:' || req.id);
  end if;

  return jsonb_build_object('leave_request_id', req.id, 'status', req.status, 'days_count', req.days_count,
                            'task_conflicts', conflicts, 'overlapping_requests', overlapping);
end;
$$;

-- Manager decision. Re-checks state and conflicts at decision time; exactly one concurrent decision wins.
create or replace function public.review_leave(p_id uuid, p_decision text, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  req public.leave_requests;
  conflicts jsonb;
  tz text;
  emp_name text;
begin
  select * into req from public.leave_requests where id = p_id for update;
  if req.id is null or not app.is_manager(req.organization_id) then perform app.fail('NOT_FOUND'); end if;
  if req.status <> 'pending' then perform app.fail('LEAVE_ALREADY_REVIEWED', jsonb_build_object('status', req.status)); end if;
  if req.employee_id = me then perform app.fail('FORBIDDEN', '{"reason":"self_review"}'); end if;
  if p_decision not in ('approve', 'reject') then perform app.fail('VALIDATION_FAILED', '{"field":"decision"}'); end if;
  if p_decision = 'reject' and char_length(trim(coalesce(p_comment, ''))) = 0 then perform app.fail('VALIDATION_FAILED', '{"field":"comment"}'); end if;
  if not app.is_active_member_user(req.organization_id, req.employee_id) then perform app.fail('MEMBER_INACTIVE'); end if;

  select timezone into tz from public.organizations where id = req.organization_id;
  begin
    update public.leave_requests set
      status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
      manager_comment = nullif(trim(coalesce(p_comment, '')), ''),
      reviewed_by = me,
      reviewed_at = now(),
      days_count = case when all_day then app.leave_days(organization_id, (start_at at time zone tz)::date, ((end_at at time zone tz) - interval '1 second')::date) else days_count end
    where id = req.id
    returning * into req;
  exception when exclusion_violation then
    perform app.fail('LEAVE_OVERLAP');
  end;

  conflicts := app.leave_task_conflicts(req.employee_id, req.start_at, req.end_at);
  select full_name into emp_name from public.profiles where id = req.employee_id;

  perform app.emit(req.organization_id, 'leave.' || req.status, 'leave_request', req.id, array[req.employee_id], 'leave.' || req.status,
    jsonb_build_object('start_at', req.start_at, 'end_at', req.end_at, 'days', req.days_count, 'has_comment', req.manager_comment is not null),
    'critical', 'leave.' || req.status || ':' || req.id);

  if req.status = 'approved' and jsonb_array_length(conflicts) > 0 then
    perform app.emit(req.organization_id, 'leave.task_conflict', 'leave_request', req.id, app.org_managers(req.organization_id), 'leave.task_conflict',
      jsonb_build_object('employee_name', emp_name, 'conflicting_task_count', jsonb_array_length(conflicts)), 'critical', 'leave.task_conflict:' || req.id);
  end if;

  return jsonb_build_object('leave_request_id', req.id, 'status', req.status, 'days_count', req.days_count, 'task_conflicts', conflicts);
end;
$$;

-- Owner edits / cancels a pending request; managers may also cancel an approved one (balance is restored).
create or replace function public.update_leave(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  req public.leave_requests;
  tz text;
  from_date date;
  to_date date;
begin
  select * into req from public.leave_requests where id = p_id for update;
  if req.id is null or not (req.employee_id = me or app.is_manager(req.organization_id)) then perform app.fail('NOT_FOUND'); end if;

  if (p ->> 'status') = 'cancelled' then
    if req.status = 'pending' or (req.status = 'approved' and app.is_manager(req.organization_id)) then
      update public.leave_requests set status = 'cancelled' where id = req.id;
      return jsonb_build_object('leave_request_id', req.id, 'status', 'cancelled');
    end if;
    perform app.fail('LEAVE_NOT_PENDING');
  end if;

  if req.status <> 'pending' or req.employee_id <> me then perform app.fail('LEAVE_NOT_PENDING'); end if;
  select timezone into tz from public.organizations where id = req.organization_id;
  from_date := coalesce((p ->> 'start_date')::date, (req.start_at at time zone tz)::date);
  to_date := coalesce((p ->> 'end_date')::date, ((req.end_at at time zone tz) - interval '1 second')::date);
  if to_date < from_date then perform app.fail('VALIDATION_FAILED', '{"field":"end_date"}'); end if;

  update public.leave_requests set
    start_at = from_date::timestamp at time zone tz,
    end_at = (to_date + 1)::timestamp at time zone tz,
    all_day = true,
    days_count = app.leave_days(organization_id, from_date, to_date),
    leave_type_id = coalesce((p ->> 'leave_type_id')::uuid, leave_type_id),
    reason_private = coalesce(nullif(trim(p ->> 'reason'), ''), reason_private)
  where id = req.id;
  return jsonb_build_object('leave_request_id', req.id, 'status', 'pending');
end;
$$;

revoke all on function public.submit_leave(jsonb), public.review_leave(uuid, text, text), public.update_leave(uuid, jsonb), public.leave_balance(uuid, integer) from public, anon;
grant execute on function public.submit_leave(jsonb), public.review_leave(uuid, text, text), public.update_leave(uuid, jsonb), public.leave_balance(uuid, integer) to authenticated;
