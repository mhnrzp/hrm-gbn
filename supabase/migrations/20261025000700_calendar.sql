-- 0007 meetings (Figma «جلسه»), conflict detection, slot suggestion, and the safe calendar read model.

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  event_type text not null default 'meeting' check (event_type in ('meeting')),
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '' check (char_length(description) <= 2000),
  location text not null default '' check (char_length(location) <= 200),
  start_at timestamptz not null,
  end_at timestamptz not null,
  organizer_id uuid not null references public.profiles (id),
  created_by uuid not null references public.profiles (id),
  is_cancelled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  check (end_at > start_at and end_at - start_at <= interval '24 hours'),
  foreign key (organization_id, organizer_id) references public.organization_memberships (organization_id, user_id)
);
create index calendar_events_time_idx on public.calendar_events (organization_id, start_at, end_at) where not is_cancelled;
create trigger calendar_events_updated_at before update on public.calendar_events for each row execute function app.set_updated_at();
create trigger calendar_events_audit after insert or update on public.calendar_events for each row execute function app.audit_row();

create table public.calendar_event_attendees (
  organization_id uuid not null,
  event_id uuid not null,
  user_id uuid not null references public.profiles (id),
  primary key (event_id, user_id),
  foreign key (organization_id, event_id) references public.calendar_events (organization_id, id),
  foreign key (organization_id, user_id) references public.organization_memberships (organization_id, user_id)
);
create index event_attendees_user_idx on public.calendar_event_attendees (user_id);

create or replace function app.can_see_event(ev uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.calendar_events e
    where e.id = ev and app.is_active_member(e.organization_id) and (
      app.is_manager(e.organization_id) or e.organizer_id = (select auth.uid())
      or exists (select 1 from public.calendar_event_attendees a where a.event_id = e.id and a.user_id = (select auth.uid())))
  );
$$;
revoke all on function app.can_see_event(uuid) from public;
grant execute on function app.can_see_event(uuid) to authenticated;

alter table public.calendar_events enable row level security;
alter table public.calendar_event_attendees enable row level security;
revoke all on public.calendar_events, public.calendar_event_attendees from anon, authenticated;
grant select on public.calendar_events, public.calendar_event_attendees to authenticated;
create policy calendar_events_select on public.calendar_events for select to authenticated using (app.can_see_event(id));
create policy event_attendees_select on public.calendar_event_attendees for select to authenticated using (app.can_see_event(event_id));

-- Everything that makes `uid` busy in [s, e): approved leave, open task windows, other meetings.
create or replace function app.busy_items(uid uuid, s timestamptz, e timestamptz, exclude_event uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by x ->> 'start_at'), '[]'::jsonb) from (
    select jsonb_build_object('kind', 'approved_leave', 'id', l.id, 'title', null, 'start_at', l.start_at, 'end_at', l.end_at) as x
    from public.leave_requests l
    where l.employee_id = uid and l.status = 'approved' and tstzrange(l.start_at, l.end_at) && tstzrange(s, e)
    union all
    select jsonb_build_object('kind', 'already_scheduled_work', 'id', o.id, 'title', t.title,
                              'start_at', coalesce(o.scheduled_start_at, o.due_at), 'end_at', o.due_at)
    from public.task_occurrences o join public.tasks t on t.id = o.task_id
    where o.status in ('todo', 'in_progress') and o.scheduled_start_at is not null
      and (o.claimed_by = uid or exists (select 1 from public.task_occurrence_assignees a where a.occurrence_id = o.id and a.user_id = uid))
      and tstzrange(o.scheduled_start_at, o.due_at, '[]') && tstzrange(s, e)
    union all
    select jsonb_build_object('kind', 'meeting', 'id', ev.id, 'title', ev.title, 'start_at', ev.start_at, 'end_at', ev.end_at)
    from public.calendar_events ev
    where not ev.is_cancelled and ev.id is distinct from exclude_event and tstzrange(ev.start_at, ev.end_at) && tstzrange(s, e)
      and (ev.organizer_id = uid or exists (select 1 from public.calendar_event_attendees a where a.event_id = ev.id and a.user_id = uid))
  ) q;
$$;
revoke all on function app.busy_items(uuid, timestamptz, timestamptz, uuid) from public;

-- Spec §6.4 status for one person and window.
create or replace function app.availability_status(uid uuid, s timestamptz, e timestamptz, exclude_event uuid default null)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.leave_requests l where l.employee_id = uid and l.status = 'approved' and tstzrange(l.start_at, l.end_at) && tstzrange(s, e)) then 'approved_leave'
    when jsonb_array_length(app.busy_items(uid, s, e, exclude_event)) > 0 then 'already_scheduled_work'
    when exists (select 1 from public.availability_occurrences ao where ao.employee_id = uid and ao.start_at <= s and ao.end_at >= e) then 'available'
    else 'no_declared_availability'
  end;
$$;
revoke all on function app.availability_status(uuid, timestamptz, timestamptz, uuid) from public;

-- First conflict-free slot of the same length for all users: same day onward, 08:00–18:00 org time, 30-minute steps.
create or replace function app.suggest_slot(org uuid, users uuid[], s timestamptz, e timestamptz, exclude_event uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.organizations;
  dur interval := e - s;
  day date;
  candidate timestamp;
  cs timestamptz;
  ce timestamptz;
  i integer;
begin
  select * into o from public.organizations where id = org;
  for i in 0 .. 6 loop
    day := (s at time zone o.timezone)::date + i;
    continue when extract(dow from day)::smallint = any (o.weekend_days);
    candidate := day + time '08:00';
    while candidate + dur <= day + time '18:00' loop
      cs := candidate at time zone o.timezone;
      ce := cs + dur;
      if cs > now() and not exists (select 1 from unnest(users) u where jsonb_array_length(app.busy_items(u, cs, ce, exclude_event)) > 0) then
        return jsonb_build_object('start_at', cs, 'end_at', ce);
      end if;
      candidate := candidate + interval '30 minutes';
    end loop;
  end loop;
  return null;
end;
$$;
revoke all on function app.suggest_slot(uuid, uuid[], timestamptz, timestamptz, uuid) from public;

-- Create / update a meeting. With conflicts and no p ->> 'force', nothing is saved and the
-- conflicts + a suggested slot come back for the «تداخل در زمان‌بندی» dialog.
create or replace function public.save_event(p jsonb, p_event uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  org uuid;
  ev public.calendar_events;
  s timestamptz := (p ->> 'start_at')::timestamptz;
  e timestamptz := (p ->> 'end_at')::timestamptz;
  users uuid[];
  u uuid;
  conflicts jsonb;
begin
  if p_event is not null then
    select * into ev from public.calendar_events where id = p_event for update;
    if ev.id is null or ev.is_cancelled or not (app.is_manager(ev.organization_id) or ev.organizer_id = me) then perform app.fail('NOT_FOUND'); end if;
    org := ev.organization_id;
    s := coalesce(s, ev.start_at);
    e := coalesce(e, ev.end_at);
    users := case when p ? 'attendee_ids' then array(select jsonb_array_elements_text(p -> 'attendee_ids')::uuid)
                  else array(select user_id from public.calendar_event_attendees where event_id = ev.id) end;
  else
    org := (p ->> 'organization_id')::uuid;
    if not app.is_manager(org) then perform app.fail('FORBIDDEN'); end if;
    users := array(select jsonb_array_elements_text(coalesce(p -> 'attendee_ids', '[]'))::uuid);
  end if;
  if s is null or e is null or e <= s then perform app.fail('VALIDATION_FAILED', '{"field":"end_at"}'); end if;
  if cardinality(users) = 0 then perform app.fail('VALIDATION_FAILED', '{"field":"attendee_ids"}'); end if;
  foreach u in array users loop
    if not app.is_active_member_user(org, u) then perform app.fail('MEMBER_INACTIVE', jsonb_build_object('user_id', u)); end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('user_id', x.uid, 'full_name', pr.full_name, 'items', x.items)), '[]'::jsonb)
    into conflicts
    from (select uid, app.busy_items(uid, s, e, ev.id) as items from unnest(users) uid) x
    join public.profiles pr on pr.id = x.uid
    where jsonb_array_length(x.items) > 0;

  if jsonb_array_length(conflicts) > 0 and not coalesce((p ->> 'force')::boolean, false) then
    return jsonb_build_object('saved', false, 'conflicts', conflicts, 'suggested', app.suggest_slot(org, users, s, e, ev.id));
  end if;

  if ev.id is null then
    insert into public.calendar_events (organization_id, title, description, location, start_at, end_at, organizer_id, created_by)
    values (org, p ->> 'title', coalesce(p ->> 'description', ''), coalesce(p ->> 'location', ''), s, e,
            coalesce((p ->> 'organizer_id')::uuid, me), me)
    returning * into ev;
  else
    update public.calendar_events set
      title = coalesce(p ->> 'title', title), description = coalesce(p ->> 'description', description),
      location = coalesce(p ->> 'location', location), start_at = s, end_at = e
    where id = ev.id returning * into ev;
    delete from public.calendar_event_attendees where event_id = ev.id and user_id <> all (users);
  end if;
  insert into public.calendar_event_attendees (organization_id, event_id, user_id)
    select org, ev.id, x from unnest(users) x on conflict do nothing;

  perform app.emit(org, 'event.scheduled', 'calendar_event', ev.id, array(select x from unnest(users) x where x <> me), 'event.scheduled',
    jsonb_build_object('title', ev.title, 'start_at', ev.start_at, 'end_at', ev.end_at), 'general',
    'event.scheduled:' || ev.id || ':' || extract(epoch from ev.start_at)::bigint);

  return jsonb_build_object('saved', true, 'event_id', ev.id, 'conflicts', conflicts);
end;
$$;

create or replace function public.cancel_event(p_event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.calendar_events;
begin
  select * into ev from public.calendar_events where id = p_event for update;
  if ev.id is null or not (app.is_manager(ev.organization_id) or ev.organizer_id = auth.uid()) then perform app.fail('NOT_FOUND'); end if;
  if ev.is_cancelled then return; end if;
  update public.calendar_events set is_cancelled = true where id = ev.id;
  perform app.emit(ev.organization_id, 'event.cancelled', 'calendar_event', ev.id,
    array(select user_id from public.calendar_event_attendees where event_id = ev.id and user_id <> auth.uid()), 'event.cancelled',
    jsonb_build_object('title', ev.title, 'start_at', ev.start_at), 'general', 'event.cancelled:' || ev.id);
end;
$$;

-- Availability check for one person (self, or managers for anyone in the org).
create or replace function public.check_availability(p_user uuid, p_start timestamptz, p_end timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org uuid;
begin
  select organization_id into org from public.organization_memberships where user_id = p_user and status = 'active' limit 1;
  if org is null or not (p_user = auth.uid() or app.is_manager(org)) then perform app.fail('NOT_FOUND'); end if;
  return jsonb_build_object('status', app.availability_status(p_user, p_start, p_end), 'items', app.busy_items(p_user, p_start, p_end));
end;
$$;

-- Safe merged calendar feed. Never returns leave reasons; others' tasks only to managers; meeting
-- details only to participants and managers (others see a busy «جلسه» block).
create or replace function public.calendar_feed(p_from timestamptz, p_to timestamptz, p_employee_ids uuid[] default null)
returns table (type text, id uuid, employee_id uuid, start_at timestamptz, end_at timestamptz, title text, status text, meta jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  org uuid;
  is_mgr boolean;
begin
  select m.organization_id into org from public.organization_memberships m where m.user_id = me and m.status = 'active' order by m.created_at limit 1;
  if org is null then perform app.fail('FORBIDDEN'); end if;
  if p_to <= p_from then perform app.fail('VALIDATION_FAILED', '{"field":"to"}'); end if;
  if p_to - p_from > interval '92 days' then perform app.fail('CALENDAR_RANGE_TOO_LARGE'); end if;
  is_mgr := app.is_manager(org);

  return query
  with members as (
    select m.user_id from public.organization_memberships m
    where m.organization_id = org and m.status = 'active' and (p_employee_ids is null or m.user_id = any (p_employee_ids))
  )
  -- tasks (one row per assignee)
  select 'task'::text, o.id, a.user_id, coalesce(o.scheduled_start_at, o.due_at), o.due_at, t.title, o.status,
         jsonb_build_object('priority', t.priority, 'task_id', t.id, 'is_overdue', o.due_at < now() and o.status in ('todo', 'in_progress'), 'has_window', o.scheduled_start_at is not null)
  from public.task_occurrences o
  join public.tasks t on t.id = o.task_id
  join public.task_occurrence_assignees a on a.occurrence_id = o.id
  join members mb on mb.user_id = a.user_id
  where o.organization_id = org and o.status <> 'cancelled'
    and tstzrange(coalesce(o.scheduled_start_at, o.due_at), o.due_at, '[]') && tstzrange(p_from, p_to)
    and (is_mgr or a.user_id = me)
  union all
  -- leave: approved for everyone (no reason); pending only for the employee and managers
  select 'leave', l.id, l.employee_id, l.start_at, l.end_at, null::text, l.status,
         case when is_mgr or l.employee_id = me
              then jsonb_build_object('leave_type', lt.name, 'days', l.days_count, 'all_day', l.all_day)
              else jsonb_build_object('all_day', l.all_day) end
  from public.leave_requests l
  join public.leave_types lt on lt.id = l.leave_type_id
  join members mb on mb.user_id = l.employee_id
  where l.organization_id = org and tstzrange(l.start_at, l.end_at) && tstzrange(p_from, p_to)
    and (l.status = 'approved' or (l.status = 'pending' and (is_mgr or l.employee_id = me)))
  union all
  -- effective availability = declared minus approved leave (unknown time is simply absent)
  select 'availability', ao.id, ao.employee_id, lower(piece), upper(piece), null::text, null::text,
         jsonb_build_object('note', ar.note, 'rule_id', ar.id, 'recurring', ar.recurrence_type <> 'none')
  from public.availability_occurrences ao
  join public.availability_rules ar on ar.id = ao.rule_id and ar.is_active
  join members mb on mb.user_id = ao.employee_id
  cross join lateral unnest(
    tstzmultirange(tstzrange(ao.start_at, ao.end_at))
    - coalesce((select range_agg(tstzrange(l.start_at, l.end_at)) from public.leave_requests l
                where l.employee_id = ao.employee_id and l.status = 'approved' and tstzrange(l.start_at, l.end_at) && tstzrange(ao.start_at, ao.end_at)),
               '{}'::tstzmultirange)
  ) piece
  where ao.organization_id = org and tstzrange(ao.start_at, ao.end_at) && tstzrange(p_from, p_to)
  union all
  -- meetings, one row per participant
  select 'meeting', ev.id, pp.uid, ev.start_at, ev.end_at,
         case when is_mgr or pp.is_participant_me then ev.title else 'جلسه' end, null::text,
         case when is_mgr or pp.is_participant_me
              then jsonb_build_object('location', ev.location, 'organizer_id', ev.organizer_id, 'details', true)
              else jsonb_build_object('details', false) end
  from public.calendar_events ev
  cross join lateral (
    select x.uid, exists (select 1 from public.calendar_event_attendees a2 where a2.event_id = ev.id and a2.user_id = me) or ev.organizer_id = me as is_participant_me
    from (select a.user_id as uid from public.calendar_event_attendees a where a.event_id = ev.id) x
  ) pp
  join members mb on mb.user_id = pp.uid
  where ev.organization_id = org and not ev.is_cancelled and tstzrange(ev.start_at, ev.end_at) && tstzrange(p_from, p_to);
end;
$$;

-- Manager «تداخل‌های زمان‌بندی» panel: meetings overlapping work, and leave overlapping open tasks.
create or replace function public.schedule_conflicts(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org uuid;
  result jsonb;
begin
  select m.organization_id into org from public.organization_memberships m where m.user_id = auth.uid() and m.status = 'active' order by m.created_at limit 1;
  if org is null or not app.is_manager(org) then perform app.fail('FORBIDDEN'); end if;
  if p_to - p_from > interval '92 days' then perform app.fail('CALENDAR_RANGE_TOO_LARGE'); end if;

  select coalesce(jsonb_agg(c order by c ->> 'start_at'), '[]'::jsonb) into result from (
    select jsonb_build_object('kind', 'meeting_overlap', 'event_id', ev.id, 'title', ev.title, 'user_id', a.user_id, 'full_name', pr.full_name,
                              'start_at', ev.start_at, 'end_at', ev.end_at, 'items', app.busy_items(a.user_id, ev.start_at, ev.end_at, ev.id)) as c
    from public.calendar_events ev
    join public.calendar_event_attendees a on a.event_id = ev.id
    join public.profiles pr on pr.id = a.user_id
    where ev.organization_id = org and not ev.is_cancelled and tstzrange(ev.start_at, ev.end_at) && tstzrange(p_from, p_to)
      and jsonb_array_length(app.busy_items(a.user_id, ev.start_at, ev.end_at, ev.id)) > 0
    union all
    select jsonb_build_object('kind', 'leave_task', 'leave_request_id', l.id, 'leave_status', l.status, 'user_id', l.employee_id, 'full_name', pr.full_name,
                              'start_at', l.start_at, 'end_at', l.end_at, 'items', app.leave_task_conflicts(l.employee_id, l.start_at, l.end_at))
    from public.leave_requests l join public.profiles pr on pr.id = l.employee_id
    where l.organization_id = org and l.status in ('pending', 'approved') and tstzrange(l.start_at, l.end_at) && tstzrange(p_from, p_to)
      and jsonb_array_length(app.leave_task_conflicts(l.employee_id, l.start_at, l.end_at)) > 0
  ) q;
  return result;
end;
$$;

revoke all on function public.save_event(jsonb, uuid), public.cancel_event(uuid), public.check_availability(uuid, timestamptz, timestamptz),
  public.calendar_feed(timestamptz, timestamptz, uuid[]), public.schedule_conflicts(timestamptz, timestamptz) from public, anon;
grant execute on function public.save_event(jsonb, uuid), public.cancel_event(uuid), public.check_availability(uuid, timestamptz, timestamptz),
  public.calendar_feed(timestamptz, timestamptz, uuid[]), public.schedule_conflicts(timestamptz, timestamptz) to authenticated;
