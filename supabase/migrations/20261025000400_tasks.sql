-- 0004 tasks: series definitions, independent occurrences, per-assignee progress, comments.
-- Writes go only through the RPCs below; clients get SELECT (filtered by RLS) and nothing else.

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '' check (char_length(description) <= 4000),
  priority text not null default 'normal' check (priority in ('normal', 'important', 'urgent')),
  assignment_mode text not null default 'named' check (assignment_mode in ('named', 'team_pool')),
  completion_policy text not null default 'any_one' check (completion_policy in ('any_one', 'all_assignees')),
  created_by uuid not null references public.profiles (id),
  -- Local schedule of the first occurrence (anchor) in `timezone`; recurrence repeats it.
  due_date date not null,
  due_time time not null default '17:00',
  start_date date,
  start_time time,
  timezone text not null,
  recurrence_type text not null default 'none' check (recurrence_type in ('none', 'daily', 'weekly', 'monthly', 'interval_days')),
  recurrence_interval integer not null default 1 check (recurrence_interval between 1 and 365),
  recurrence_days_of_week smallint[] check (recurrence_days_of_week <@ '{0,1,2,3,4,5,6}'::smallint[]),
  recurrence_end_date date,
  is_active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  check (start_date is null or start_date <= due_date),
  check (recurrence_end_date is null or recurrence_end_date >= due_date),
  check ((archived_at is null) = is_active)
);
create index tasks_org_idx on public.tasks (organization_id, is_active);
create trigger tasks_updated_at before update on public.tasks for each row execute function app.set_updated_at();

create table public.task_assignees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  task_id uuid not null,
  user_id uuid not null references public.profiles (id),
  assigned_at timestamptz not null default now(),
  unique (task_id, user_id),
  foreign key (organization_id, task_id) references public.tasks (organization_id, id),
  foreign key (organization_id, user_id) references public.organization_memberships (organization_id, user_id)
);

create table public.task_occurrences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  task_id uuid not null,
  local_due_date date not null,
  due_at timestamptz not null,
  scheduled_start_at timestamptz,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'completed', 'cancelled')),
  claimed_by uuid references public.profiles (id),
  completed_at timestamptz,
  completed_by uuid references public.profiles (id),
  generation_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, generation_key),
  unique (organization_id, id),
  foreign key (organization_id, task_id) references public.tasks (organization_id, id),
  check ((status = 'completed') = (completed_at is not null)),
  check (scheduled_start_at is null or scheduled_start_at <= due_at)
);
create index task_occurrences_org_due_idx on public.task_occurrences (organization_id, due_at);
create index task_occurrences_task_idx on public.task_occurrences (task_id, local_due_date);
create trigger task_occurrences_updated_at before update on public.task_occurrences for each row execute function app.set_updated_at();

create table public.task_occurrence_assignees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  occurrence_id uuid not null,
  user_id uuid not null references public.profiles (id),
  progress_status text not null default 'todo' check (progress_status in ('todo', 'in_progress', 'completed')),
  progress_percent smallint not null default 0 check (progress_percent between 0 and 100),
  completed_at timestamptz,
  assigned_at timestamptz not null default now(),
  unique (occurrence_id, user_id),
  foreign key (organization_id, occurrence_id) references public.task_occurrences (organization_id, id),
  foreign key (organization_id, user_id) references public.organization_memberships (organization_id, user_id)
);
create index toa_user_idx on public.task_occurrence_assignees (user_id, progress_status);

create table public.task_updates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  occurrence_id uuid not null,
  author_id uuid not null references public.profiles (id),
  update_type text not null check (update_type in ('comment', 'progress', 'status_change', 'assignment_change')),
  body text check (char_length(body) <= 2000),
  metadata jsonb,
  created_at timestamptz not null default now(),
  foreign key (organization_id, occurrence_id) references public.task_occurrences (organization_id, id)
);
create index task_updates_occ_idx on public.task_updates (occurrence_id, created_at);

create trigger tasks_audit after insert or update on public.tasks for each row execute function app.audit_row('description');
create trigger task_occurrences_audit after update on public.task_occurrences for each row execute function app.audit_row();
create trigger task_assignees_audit after insert or delete on public.task_assignees for each row execute function app.audit_row();

-- ── Recurrence expansion (pure): local dates of a series between p_from and p_to ──
-- Monthly follows the Jalali calendar (the organisation calendar): same Jalali day-of-month as the anchor,
-- clamped to the month's last day (31 Shahrivar → 30 Mehr, 30 Bahman → 29 Esfand in common years).
create or replace function app.recurrence_dates(
  p_anchor date, p_type text, p_interval integer, p_dows smallint[], p_end date, p_from date, p_to date, p_week_start integer default 6
)
returns setof date
language sql
immutable
set search_path = ''
as $$
  with b as (
    select greatest(p_anchor, p_from) as lo,
           least(coalesce(p_end, p_to), p_to) as hi,
           p_anchor - ((extract(dow from p_anchor)::int - p_week_start + 7) % 7) as anchor_week
  )
  select p_anchor where p_type = 'none'
  union all
  select d::date from b, generate_series(p_anchor::timestamp, b.hi::timestamp, make_interval(days => p_interval)) d
  where p_type in ('daily', 'interval_days') and d::date >= b.lo
  union all
  select d::date from b, generate_series(greatest(b.lo, p_anchor)::timestamp, b.hi::timestamp, interval '1 day') d
  where p_type = 'weekly'
    and extract(dow from d)::smallint = any (coalesce(p_dows, array[extract(dow from p_anchor)::smallint]))
    and ((d::date - b.anchor_week) / 7) % p_interval = 0
  union all
  select c from b, lateral (
    select app.add_jalali_months(p_anchor, k * p_interval) as c
    from generate_series(0, (((b.hi - p_anchor) / 29) + 1) / p_interval + 1) k
  ) months
  where p_type = 'monthly' and c between b.lo and b.hi;
$$;

-- Generate occurrences (+ named assignees) for one task or all active tasks up to the horizon.
-- Idempotent: unique (task_id, generation_key) + ON CONFLICT DO NOTHING; safe to run concurrently.
create or replace function app.generate_task_occurrences(p_task uuid default null, p_horizon_days integer default 90, p_from date default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
  total integer := 0;
  n integer;
  last_date date;
begin
  for t in
    select tk.*, o.week_start
    from public.tasks tk join public.organizations o on o.id = tk.organization_id
    where tk.is_active and (p_task is null or tk.id = p_task)
  loop
    select max(local_due_date) into last_date from public.task_occurrences where task_id = t.id;
    with ins as (
      insert into public.task_occurrences (organization_id, task_id, local_due_date, due_at, scheduled_start_at, generation_key)
      select t.organization_id, t.id, d,
             (d + t.due_time) at time zone t.timezone,
             case when t.start_date is not null
                  then least((d - (t.due_date - t.start_date)) + coalesce(t.start_time, time '09:00'), d + t.due_time) at time zone t.timezone end,
             to_char(d, 'YYYY-MM-DD')
      from app.recurrence_dates(t.due_date, t.recurrence_type, t.recurrence_interval, t.recurrence_days_of_week, t.recurrence_end_date,
                                coalesce(p_from, last_date + 1, t.due_date),
                                ((now() at time zone t.timezone)::date + p_horizon_days), t.week_start) d
      on conflict (task_id, generation_key) do nothing
      returning id
    ),
    ass as (
      insert into public.task_occurrence_assignees (organization_id, occurrence_id, user_id)
      select t.organization_id, ins.id, ta.user_id
      from ins join public.task_assignees ta on ta.task_id = t.id
      where t.assignment_mode = 'named' and app.is_active_member_user(t.organization_id, ta.user_id)
      returning 1
    )
    select count(*) into n from ins;
    total := total + n;
  end loop;
  return total;
end;
$$;
revoke all on function app.generate_task_occurrences(uuid, integer, date) from public;

-- Placeholder replaced in the leave migration: approved-leave warnings for assignees.
create or replace function app.assignment_warnings(org uuid, users uuid[], start_at timestamptz, due_at timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $$ select '[]'::jsonb $$;

-- ── Visibility helpers (security definer: avoid recursive RLS between task tables) ──

create or replace function app.can_see_occurrence(occ uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.task_occurrences o join public.tasks t on t.id = o.task_id
    where o.id = occ and (
      app.is_manager(o.organization_id)
      or (app.is_active_member(o.organization_id) and (
            o.claimed_by = (select auth.uid())
            or exists (select 1 from public.task_occurrence_assignees a where a.occurrence_id = o.id and a.user_id = (select auth.uid()))
            or (t.assignment_mode = 'team_pool' and o.claimed_by is null and o.status = 'todo' and t.is_active)))
    )
  );
$$;

create or replace function app.can_see_task(tid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = tid and (
      app.is_manager(t.organization_id)
      or (app.is_active_member(t.organization_id) and (
            t.assignment_mode = 'team_pool'
            or exists (select 1 from public.task_assignees a where a.task_id = t.id and a.user_id = (select auth.uid()))
            or exists (select 1 from public.task_occurrences o join public.task_occurrence_assignees a on a.occurrence_id = o.id
                       where o.task_id = t.id and a.user_id = (select auth.uid()))))
    )
  );
$$;
revoke all on function app.can_see_occurrence(uuid), app.can_see_task(uuid) from public;
grant execute on function app.can_see_occurrence(uuid), app.can_see_task(uuid) to authenticated;

alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;
alter table public.task_occurrences enable row level security;
alter table public.task_occurrence_assignees enable row level security;
alter table public.task_updates enable row level security;
revoke all on public.tasks, public.task_assignees, public.task_occurrences, public.task_occurrence_assignees, public.task_updates from anon, authenticated;
grant select on public.tasks, public.task_assignees, public.task_occurrences, public.task_occurrence_assignees, public.task_updates to authenticated;

create policy tasks_select on public.tasks for select to authenticated using (app.can_see_task(id));
create policy task_assignees_select on public.task_assignees for select to authenticated using (app.can_see_task(task_id));
create policy task_occurrences_select on public.task_occurrences for select to authenticated using (app.can_see_occurrence(id));
create policy toa_select on public.task_occurrence_assignees for select to authenticated using (app.can_see_occurrence(occurrence_id));
create policy task_updates_select on public.task_updates for select to authenticated using (app.can_see_occurrence(occurrence_id));

-- ── RPCs ──

-- Recompute an occurrence's overall status from its assignments and completion policy.
create or replace function app.recompute_occurrence(occ uuid, actor uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.task_occurrences;
  policy text;
  total integer;
  done integer;
  started integer;
  new_status text;
begin
  select * into o from public.task_occurrences where id = occ;
  if o.status in ('completed', 'cancelled') then return o.status; end if;
  select t.completion_policy into policy from public.tasks t where t.id = o.task_id;
  select count(*), count(*) filter (where progress_status = 'completed'),
         count(*) filter (where progress_status <> 'todo' or progress_percent > 0)
    into total, done, started
    from public.task_occurrence_assignees where occurrence_id = occ;

  new_status := case
    when total > 0 and ((policy = 'any_one' and done > 0) or (policy = 'all_assignees' and done = total)) then 'completed'
    when started > 0 then 'in_progress'
    else 'todo'
  end;
  if new_status <> o.status then
    update public.task_occurrences
      set status = new_status,
          completed_at = case when new_status = 'completed' then now() end,
          completed_by = case when new_status = 'completed' then actor end
      where id = occ;
  end if;
  return new_status;
end;
$$;
revoke all on function app.recompute_occurrence(uuid, uuid) from public;

-- Manager creates a task series + assignees + first occurrence(s) in one transaction.
create or replace function public.create_task(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  org uuid := (p ->> 'organization_id')::uuid;
  tz text;
  new_task public.tasks;
  users uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'assignee_ids', '[]'))::uuid), '{}');
  u uuid;
  first_occ public.task_occurrences;
  warnings jsonb;
begin
  if not app.is_manager(org) then perform app.fail('FORBIDDEN'); end if;
  select timezone into tz from public.organizations where id = org;

  if coalesce(p ->> 'assignment_mode', 'named') = 'named' and cardinality(users) = 0 then
    perform app.fail('VALIDATION_FAILED', '{"field":"assignee_ids"}');
  end if;
  foreach u in array users loop
    if not app.is_active_member_user(org, u) then perform app.fail('MEMBER_INACTIVE', jsonb_build_object('user_id', u)); end if;
  end loop;

  insert into public.tasks (organization_id, title, description, priority, assignment_mode, completion_policy, created_by,
                            due_date, due_time, start_date, start_time, timezone,
                            recurrence_type, recurrence_interval, recurrence_days_of_week, recurrence_end_date)
  values (org, p ->> 'title', coalesce(p ->> 'description', ''), coalesce(p ->> 'priority', 'normal'),
          coalesce(p ->> 'assignment_mode', 'named'), coalesce(p ->> 'completion_policy', 'any_one'), me,
          (p ->> 'due_date')::date, coalesce((p ->> 'due_time')::time, time '17:00'),
          (p ->> 'start_date')::date, (p ->> 'start_time')::time, tz,
          coalesce(p ->> 'recurrence_type', 'none'), coalesce((p ->> 'recurrence_interval')::int, 1),
          case when p ? 'recurrence_days_of_week' and jsonb_typeof(p -> 'recurrence_days_of_week') = 'array'
               then array(select jsonb_array_elements_text(p -> 'recurrence_days_of_week')::smallint) end,
          (p ->> 'recurrence_end_date')::date)
  returning * into new_task;

  if new_task.assignment_mode = 'named' then
    insert into public.task_assignees (organization_id, task_id, user_id) select org, new_task.id, x from unnest(users) x;
  end if;

  perform app.generate_task_occurrences(new_task.id, 90, new_task.due_date);
  select * into first_occ from public.task_occurrences where task_id = new_task.id order by local_due_date limit 1;

  warnings := app.assignment_warnings(org, users, coalesce(first_occ.scheduled_start_at, first_occ.due_at), first_occ.due_at);

  perform app.emit(org, 'task.assigned', 'task_occurrence', first_occ.id,
    case when new_task.assignment_mode = 'named' then users
         else array(select m.user_id from public.organization_memberships m where m.organization_id = org and m.status = 'active' and m.role = 'employee') end,
    case when new_task.assignment_mode = 'named' then 'task.assigned' else 'task.pool_available' end,
    jsonb_build_object('task_title', new_task.title, 'due_at', first_occ.due_at, 'priority', new_task.priority),
    'critical', 'task.assigned:' || new_task.id);

  return jsonb_build_object('task_id', new_task.id, 'occurrence_id', first_occ.id, 'warnings', warnings);
end;
$$;

-- Manager edits a series. Schedule changes regenerate future, untouched occurrences only.
create or replace function public.update_task_series(p_task uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
  schedule_changed boolean;
  users uuid[];
  u uuid;
  kept_with_activity integer;
  today date;
begin
  select * into t from public.tasks where id = p_task for update;
  if t.id is null or not app.is_manager(t.organization_id) then perform app.fail('NOT_FOUND'); end if;
  if not t.is_active then perform app.fail('TASK_ARCHIVED'); end if;

  schedule_changed := p ?| array['due_date', 'due_time', 'start_date', 'start_time', 'recurrence_type', 'recurrence_interval', 'recurrence_days_of_week', 'recurrence_end_date'];

  update public.tasks set
    title = coalesce(p ->> 'title', title),
    description = coalesce(p ->> 'description', description),
    priority = coalesce(p ->> 'priority', priority),
    completion_policy = coalesce(p ->> 'completion_policy', completion_policy),
    due_date = coalesce((p ->> 'due_date')::date, due_date),
    due_time = coalesce((p ->> 'due_time')::time, due_time),
    start_date = case when p ? 'start_date' then (p ->> 'start_date')::date else start_date end,
    start_time = case when p ? 'start_time' then (p ->> 'start_time')::time else start_time end,
    recurrence_type = coalesce(p ->> 'recurrence_type', recurrence_type),
    recurrence_interval = coalesce((p ->> 'recurrence_interval')::int, recurrence_interval),
    recurrence_days_of_week = case when p ? 'recurrence_days_of_week' and jsonb_typeof(p -> 'recurrence_days_of_week') = 'array'
                                   then array(select jsonb_array_elements_text(p -> 'recurrence_days_of_week')::smallint)
                                   when p ? 'recurrence_days_of_week' then null else recurrence_days_of_week end,
    recurrence_end_date = case when p ? 'recurrence_end_date' then (p ->> 'recurrence_end_date')::date else recurrence_end_date end
  where id = t.id
  returning * into t;

  if p ? 'assignee_ids' and t.assignment_mode = 'named' then
    users := array(select jsonb_array_elements_text(p -> 'assignee_ids')::uuid);
    if cardinality(users) = 0 then perform app.fail('VALIDATION_FAILED', '{"field":"assignee_ids"}'); end if;
    foreach u in array users loop
      if not app.is_active_member_user(t.organization_id, u) then perform app.fail('MEMBER_INACTIVE', jsonb_build_object('user_id', u)); end if;
    end loop;
    delete from public.task_assignees where task_id = t.id and user_id <> all (users);
    insert into public.task_assignees (organization_id, task_id, user_id)
      select t.organization_id, t.id, x from unnest(users) x on conflict (task_id, user_id) do nothing;
    -- Open, untouched occurrences follow the new assignee list; started work keeps its people.
    delete from public.task_occurrence_assignees a using public.task_occurrences o
      where a.occurrence_id = o.id and o.task_id = t.id and o.status = 'todo' and a.progress_percent = 0 and a.user_id <> all (users);
    insert into public.task_occurrence_assignees (organization_id, occurrence_id, user_id)
      select t.organization_id, o.id, x from public.task_occurrences o cross join unnest(users) x
      where o.task_id = t.id and o.status in ('todo', 'in_progress')
      on conflict (occurrence_id, user_id) do nothing;
    perform app.emit(t.organization_id, 'task.assigned', 'task', t.id, users, 'task.assigned',
      jsonb_build_object('task_title', t.title, 'priority', t.priority), 'critical',
      'task.assigned:' || t.id || ':' || md5(array_to_string(users, ',')));
  end if;

  if schedule_changed and t.recurrence_type = 'none' then
    -- One-off: move its open occurrence rather than creating a second one.
    update public.task_occurrences set
      local_due_date = t.due_date,
      due_at = (t.due_date + t.due_time) at time zone t.timezone,
      scheduled_start_at = case when t.start_date is not null
        then least(t.start_date + coalesce(t.start_time, time '09:00'), t.due_date + t.due_time) at time zone t.timezone end,
      generation_key = to_char(t.due_date, 'YYYY-MM-DD')
    where task_id = t.id and status in ('todo', 'in_progress');
    if not found then perform app.generate_task_occurrences(t.id, 90, t.due_date); end if;
  elsif schedule_changed then
    today := (now() at time zone t.timezone)::date;
    -- Remove future occurrences nobody touched; keep anything started, commented or claimed.
    delete from public.task_occurrence_assignees a using public.task_occurrences o
      where a.occurrence_id = o.id and o.task_id = t.id and o.status = 'todo' and o.local_due_date >= today and o.claimed_by is null
        and not exists (select 1 from public.task_updates u2 where u2.occurrence_id = o.id)
        and not exists (select 1 from public.task_occurrence_assignees a2 where a2.occurrence_id = o.id and a2.progress_percent > 0);
    delete from public.task_occurrences o
      where o.task_id = t.id and o.status = 'todo' and o.local_due_date >= today and o.claimed_by is null
        and not exists (select 1 from public.task_updates u2 where u2.occurrence_id = o.id)
        and not exists (select 1 from public.task_occurrence_assignees a2 where a2.occurrence_id = o.id);
    select count(*) into kept_with_activity from public.task_occurrences
      where task_id = t.id and status in ('todo', 'in_progress') and local_due_date >= today;
    perform app.generate_task_occurrences(t.id, 90, greatest(today, t.due_date));
  end if;

  return jsonb_build_object('task_id', t.id, 'regenerated', schedule_changed, 'kept_future_with_activity', coalesce(kept_with_activity, 0));
end;
$$;

-- Archive a series: cancel untouched future occurrences, keep history.
create or replace function public.archive_task(p_task uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
begin
  select * into t from public.tasks where id = p_task for update;
  if t.id is null or not app.is_manager(t.organization_id) then perform app.fail('NOT_FOUND'); end if;
  if not t.is_active then return; end if;
  update public.tasks set is_active = false, archived_at = now() where id = t.id;
  update public.task_occurrences o set status = 'cancelled'
    where o.task_id = t.id and o.status = 'todo' and o.due_at > now()
      and not exists (select 1 from public.task_occurrence_assignees a where a.occurrence_id = o.id and a.progress_percent > 0);
end;
$$;

-- Atomic claim of a team-pool occurrence. Concurrent claims: exactly one row update succeeds.
create or replace function public.claim_occurrence(p_occurrence uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  o public.task_occurrences;
  claimed uuid;
begin
  select o2.* into o from public.task_occurrences o2 join public.tasks t on t.id = o2.task_id
    where o2.id = p_occurrence and t.assignment_mode = 'team_pool' and t.is_active;
  if o.id is null or not app.is_active_member(o.organization_id) then perform app.fail('NOT_FOUND'); end if;

  update public.task_occurrences set claimed_by = me
    where id = o.id and claimed_by is null and status = 'todo'
    returning id into claimed;
  if claimed is null then perform app.fail('TASK_ALREADY_CLAIMED'); end if;

  insert into public.task_occurrence_assignees (organization_id, occurrence_id, user_id) values (o.organization_id, o.id, me)
    on conflict (occurrence_id, user_id) do nothing;
  insert into public.task_updates (organization_id, occurrence_id, author_id, update_type, metadata)
    values (o.organization_id, o.id, me, 'assignment_change', jsonb_build_object('claimed', true));
  return o.id;
end;
$$;

-- Assignee reports progress / status (todo|in_progress) and optionally a note.
create or replace function public.update_my_progress(p_occurrence uuid, p_percent integer default null, p_status text default null, p_note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  o public.task_occurrences;
  a public.task_occurrence_assignees;
  result text;
begin
  select * into o from public.task_occurrences where id = p_occurrence for update;
  if o.id is null or not app.can_see_occurrence(o.id) then perform app.fail('NOT_FOUND'); end if;
  if o.status in ('completed', 'cancelled') then perform app.fail('TASK_CLOSED'); end if;
  select * into a from public.task_occurrence_assignees where occurrence_id = o.id and user_id = me;
  if a.id is null then perform app.fail('TASK_NOT_ASSIGNED'); end if;
  if p_status is not null and p_status not in ('todo', 'in_progress') then perform app.fail('VALIDATION_FAILED', '{"field":"status"}'); end if;
  if p_percent is not null and (p_percent < 0 or p_percent > 100) then perform app.fail('VALIDATION_FAILED', '{"field":"progress_percent"}'); end if;

  update public.task_occurrence_assignees set
    progress_percent = coalesce(p_percent, case when p_status = 'todo' then 0 else progress_percent end),
    progress_status = case
      when coalesce(p_status, '') = 'todo' then 'todo'
      when p_status = 'in_progress' or coalesce(p_percent, 0) > 0 then 'in_progress'
      else progress_status end
  where id = a.id;

  if p_status = 'todo' then
    -- Moving back to "not started" also reopens the occurrence-level status.
    update public.task_occurrences set status = 'todo' where id = o.id and status = 'in_progress'
      and not exists (select 1 from public.task_occurrence_assignees x where x.occurrence_id = o.id and x.id <> a.id and (x.progress_status <> 'todo' or x.progress_percent > 0));
  end if;

  insert into public.task_updates (organization_id, occurrence_id, author_id, update_type, body, metadata)
    values (o.organization_id, o.id, me, 'progress', nullif(trim(coalesce(p_note, '')), ''),
            jsonb_build_object('progress_percent', p_percent, 'status', p_status));

  result := app.recompute_occurrence(o.id, me);
  return result;
end;
$$;

-- Complete own assignment (or, as manager, the whole occurrence). Policy decides the overall state.
create or replace function public.complete_occurrence(p_occurrence uuid, p_note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  o public.task_occurrences;
  t public.tasks;
  is_mgr boolean;
  result text;
begin
  select * into o from public.task_occurrences where id = p_occurrence for update;
  if o.id is null or not app.can_see_occurrence(o.id) then perform app.fail('NOT_FOUND'); end if;
  if o.status = 'completed' then return 'completed'; end if;  -- idempotent
  if o.status = 'cancelled' then perform app.fail('TASK_CLOSED'); end if;
  select * into t from public.tasks where id = o.task_id;
  is_mgr := app.is_manager(o.organization_id);

  if exists (select 1 from public.task_occurrence_assignees where occurrence_id = o.id and user_id = me) then
    update public.task_occurrence_assignees set progress_status = 'completed', progress_percent = 100, completed_at = now()
      where occurrence_id = o.id and user_id = me;
    result := app.recompute_occurrence(o.id, me);
  elsif is_mgr then
    update public.task_occurrence_assignees set progress_status = 'completed', progress_percent = 100, completed_at = coalesce(completed_at, now())
      where occurrence_id = o.id;
    update public.task_occurrences set status = 'completed', completed_at = now(), completed_by = me where id = o.id;
    result := 'completed';
  else
    perform app.fail('TASK_NOT_ASSIGNED');
  end if;

  insert into public.task_updates (organization_id, occurrence_id, author_id, update_type, body, metadata)
    values (o.organization_id, o.id, me, 'status_change', nullif(trim(coalesce(p_note, '')), ''), jsonb_build_object('status', result));

  if result = 'completed' then
    perform app.emit(o.organization_id, 'task.completed', 'task_occurrence', o.id,
      array(select x from unnest(array[t.created_by] || app.org_managers(o.organization_id)) x where x <> me),
      'task.completed',
      jsonb_build_object('task_title', t.title, 'completed_by_name', (select full_name from public.profiles where id = me)),
      'general', 'task.completed:' || o.id);
  end if;
  return result;
end;
$$;

-- Manager adjusts one occurrence: status, reschedule, reassign.
create or replace function public.manage_occurrence(p_occurrence uuid, p jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  o public.task_occurrences;
  t public.tasks;
  users uuid[];
  u uuid;
  new_status text := p ->> 'status';
begin
  select * into o from public.task_occurrences where id = p_occurrence for update;
  if o.id is null or not app.is_manager(o.organization_id) then perform app.fail('NOT_FOUND'); end if;
  select * into t from public.tasks where id = o.task_id;

  if p ? 'due_at' then
    update public.task_occurrences set due_at = (p ->> 'due_at')::timestamptz,
      local_due_date = ((p ->> 'due_at')::timestamptz at time zone t.timezone)::date,
      scheduled_start_at = case when p ? 'scheduled_start_at' then (p ->> 'scheduled_start_at')::timestamptz
                                else least(scheduled_start_at, (p ->> 'due_at')::timestamptz) end
      where id = o.id;
    insert into public.task_updates (organization_id, occurrence_id, author_id, update_type, metadata)
      values (o.organization_id, o.id, me, 'status_change', jsonb_build_object('rescheduled_to', p ->> 'due_at'));
  end if;

  if p ? 'assignee_ids' then
    users := array(select jsonb_array_elements_text(p -> 'assignee_ids')::uuid);
    if cardinality(users) = 0 then perform app.fail('VALIDATION_FAILED', '{"field":"assignee_ids"}'); end if;
    foreach u in array users loop
      if not app.is_active_member_user(o.organization_id, u) then perform app.fail('MEMBER_INACTIVE', jsonb_build_object('user_id', u)); end if;
    end loop;
    delete from public.task_occurrence_assignees where occurrence_id = o.id and user_id <> all (users);
    insert into public.task_occurrence_assignees (organization_id, occurrence_id, user_id)
      select o.organization_id, o.id, x from unnest(users) x on conflict (occurrence_id, user_id) do nothing;
    insert into public.task_updates (organization_id, occurrence_id, author_id, update_type, metadata)
      values (o.organization_id, o.id, me, 'assignment_change', jsonb_build_object('assignee_ids', to_jsonb(users)));
    perform app.emit(o.organization_id, 'task.assigned', 'task_occurrence', o.id, users, 'task.assigned',
      jsonb_build_object('task_title', t.title, 'due_at', coalesce((p ->> 'due_at')::timestamptz, o.due_at), 'priority', t.priority),
      'critical', 'task.assigned:' || o.id || ':' || md5(array_to_string(users, ',')));
  end if;

  if new_status is not null then
    if new_status not in ('todo', 'in_progress', 'completed', 'cancelled') then perform app.fail('VALIDATION_FAILED', '{"field":"status"}'); end if;
    update public.task_occurrences set status = new_status,
      completed_at = case when new_status = 'completed' then coalesce(completed_at, now()) end,
      completed_by = case when new_status = 'completed' then coalesce(completed_by, me) end
      where id = o.id and status <> new_status;
    if found then
      insert into public.task_updates (organization_id, occurrence_id, author_id, update_type, metadata)
        values (o.organization_id, o.id, me, 'status_change', jsonb_build_object('status', new_status));
    end if;
  end if;
  return (select status from public.task_occurrences where id = o.id);
end;
$$;

create or replace function public.add_task_comment(p_occurrence uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  o public.task_occurrences;
  t public.tasks;
  is_assignee boolean;
  new_id uuid;
begin
  select * into o from public.task_occurrences where id = p_occurrence;
  if o.id is null or not app.can_see_occurrence(o.id) then perform app.fail('NOT_FOUND'); end if;
  is_assignee := exists (select 1 from public.task_occurrence_assignees where occurrence_id = o.id and user_id = me);
  if not is_assignee and not app.is_manager(o.organization_id) then perform app.fail('TASK_NOT_ASSIGNED'); end if;
  if char_length(trim(coalesce(p_body, ''))) = 0 then perform app.fail('VALIDATION_FAILED', '{"field":"body"}'); end if;
  select * into t from public.tasks where id = o.task_id;

  insert into public.task_updates (organization_id, occurrence_id, author_id, update_type, body)
    values (o.organization_id, o.id, me, 'comment', trim(p_body))
    returning id into new_id;

  perform app.emit(o.organization_id, 'task.updated', 'task_occurrence', o.id,
    array(select x from unnest(array(select user_id from public.task_occurrence_assignees where occurrence_id = o.id) || array[t.created_by]) x where x <> me),
    'task.commented', jsonb_build_object('task_title', t.title, 'author_name', (select full_name from public.profiles where id = me)),
    'task_status', 'task.commented:' || new_id);
  return new_id;
end;
$$;

revoke all on function public.create_task(jsonb), public.update_task_series(uuid, jsonb), public.archive_task(uuid), public.claim_occurrence(uuid),
  public.update_my_progress(uuid, integer, text, text), public.complete_occurrence(uuid, text), public.manage_occurrence(uuid, jsonb),
  public.add_task_comment(uuid, text) from public, anon;
grant execute on function public.create_task(jsonb), public.update_task_series(uuid, jsonb), public.archive_task(uuid), public.claim_occurrence(uuid),
  public.update_my_progress(uuid, integer, text, text), public.complete_occurrence(uuid, text), public.manage_occurrence(uuid, jsonb),
  public.add_task_comment(uuid, text) to authenticated;

-- ── Read model for the tasks board: one "current" occurrence per series (earliest open, else latest closed) ──
create or replace function public.task_board(
  p_status text default null,      -- todo | in_progress | completed | overdue
  p_assignee uuid default null,
  p_priority text default null,
  p_due text default null,          -- today | week | month | overdue
  p_q text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  occurrence_id uuid, task_id uuid, title text, description text, priority text, assignment_mode text, recurrence_type text,
  status text, is_overdue boolean, due_at timestamptz, scheduled_start_at timestamptz, claimed_by uuid,
  assignees jsonb, progress_percent integer, total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with org as (
    select o.id, o.timezone, (now() at time zone o.timezone)::date as today
    from public.organizations o
    where app.is_active_member(o.id)
    limit 1
  ),
  current_occ as (
    select distinct on (oc.task_id) oc.*
    from public.task_occurrences oc
    order by oc.task_id, (oc.status in ('completed', 'cancelled')),
             case when oc.status not in ('completed', 'cancelled') then oc.due_at end asc,
             oc.due_at desc
  ),
  rows as (
    select c.id as occurrence_id, t.id as task_id, t.title, t.description, t.priority, t.assignment_mode, t.recurrence_type,
           c.status, (c.due_at < now() and c.status not in ('completed', 'cancelled')) as is_overdue,
           c.due_at, c.scheduled_start_at, c.claimed_by, c.local_due_date,
           coalesce((select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'full_name', pr.full_name, 'avatar_path', pr.avatar_path,
                                                         'progress_percent', a.progress_percent, 'progress_status', a.progress_status) order by a.assigned_at)
                     from public.task_occurrence_assignees a join public.profiles pr on pr.id = a.user_id
                     where a.occurrence_id = c.id), '[]'::jsonb) as assignees,
           coalesce((select round(avg(a.progress_percent))::int from public.task_occurrence_assignees a where a.occurrence_id = c.id), 0) as progress_percent
    from current_occ c join public.tasks t on t.id = c.task_id
    where t.is_active or c.status in ('completed', 'cancelled')
  )
  select r.occurrence_id, r.task_id, r.title, r.description, r.priority, r.assignment_mode, r.recurrence_type, r.status, r.is_overdue,
         r.due_at, r.scheduled_start_at, r.claimed_by, r.assignees, r.progress_percent, count(*) over () as total_count
  from rows r, org
  where (p_status is null
         or (p_status = 'overdue' and r.is_overdue)
         or (p_status <> 'overdue' and r.status = p_status))
    and r.status <> 'cancelled'
    and (p_assignee is null or r.assignees @> jsonb_build_array(jsonb_build_object('user_id', p_assignee)))
    and (p_priority is null or r.priority = p_priority)
    and (p_due is null
         or (p_due = 'today' and r.local_due_date = org.today)
         or (p_due = 'week' and r.local_due_date between org.today and org.today + 6)
         or (p_due = 'month' and r.local_due_date between org.today and org.today + 30)
         or (p_due = 'overdue' and r.is_overdue))
    and (p_q is null or r.title ilike '%' || replace(replace(p_q, '%', '\%'), '_', '\_') || '%')
  order by r.is_overdue desc, (r.status = 'completed'), r.due_at, r.occurrence_id
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
$$;
revoke all on function public.task_board(text, uuid, text, text, text, integer, integer) from public, anon;
grant execute on function public.task_board(text, uuid, text, text, text, integer, integer) to authenticated;
