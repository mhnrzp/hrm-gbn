-- 0011 role-aware read models for the team directory, member profile and activity log.

-- Team directory: everyone sees the public projection; managers also get contact data and task load.
create or replace function public.team_directory(p_include_inactive boolean default false)
returns table (
  membership_id uuid, user_id uuid, full_name text, avatar_path text, job_title text, role text, status text,
  work_mode text, on_leave_today boolean, active_task_count integer, email text, phone text, joined_at date, manager_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  org uuid;
  is_mgr boolean;
  tz text;
begin
  select m.organization_id into org from public.organization_memberships m where m.user_id = me and m.status = 'active' order by m.created_at limit 1;
  if org is null then perform app.fail('FORBIDDEN'); end if;
  is_mgr := app.is_manager(org);
  select timezone into tz from public.organizations where id = org;

  return query
  select m.id, m.user_id, p.full_name, p.avatar_path, m.job_title, m.role, m.status, m.work_mode,
         exists (select 1 from public.leave_requests l where l.employee_id = m.user_id and l.status = 'approved'
                 and tstzrange(l.start_at, l.end_at) && tstzrange(((now() at time zone tz)::date)::timestamp at time zone tz,
                                                                   ((now() at time zone tz)::date + 1)::timestamp at time zone tz)),
         case when is_mgr or m.user_id = me then
           (select count(*)::int from public.task_occurrence_assignees a join public.task_occurrences o on o.id = a.occurrence_id
            where a.user_id = m.user_id and o.status in ('todo', 'in_progress') and o.due_at <= now() + interval '30 days') end,
         case when is_mgr or m.user_id = me then pp.email end,
         case when is_mgr or m.user_id = me then pp.phone end,
         m.joined_at,
         m.manager_id
  from public.organization_memberships m
  join public.profiles p on p.id = m.user_id
  left join public.profile_private pp on pp.user_id = m.user_id
  where m.organization_id = org
    and (m.status = 'active' or (is_mgr and (p_include_inactive or m.status = 'invited')))
  order by m.status <> 'active', p.full_name;
end;
$$;

-- Member profile («پروفایل کارمند»). Private sections only for the member and managers.
create or replace function public.member_profile(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  m public.organization_memberships;
  can_private boolean;
  tz text;
  result jsonb;
begin
  select mm.* into m from public.organization_memberships mm
    where mm.user_id = p_user and app.is_active_member(mm.organization_id) order by mm.created_at limit 1;
  if m.id is null then perform app.fail('NOT_FOUND'); end if;
  can_private := (p_user = me) or app.is_manager(m.organization_id);
  select timezone into tz from public.organizations where id = m.organization_id;

  select jsonb_build_object(
    'membership_id', m.id, 'user_id', p_user, 'full_name', p.full_name, 'avatar_path', p.avatar_path, 'job_title', m.job_title,
    'role', m.role, 'status', m.status, 'work_mode', m.work_mode, 'can_view_private', can_private,
    'on_leave_today', exists (select 1 from public.leave_requests l where l.employee_id = p_user and l.status = 'approved'
                              and now() <@ tstzrange(l.start_at, l.end_at)),
    'contact', case when can_private then jsonb_build_object(
        'email', pp.email, 'phone', pp.phone, 'joined_at', m.joined_at,
        'manager_id', m.manager_id, 'manager_name', (select full_name from public.profiles where id = m.manager_id),
        'annual_leave_quota_days', coalesce(m.annual_leave_quota_days, (select default_leave_quota_days from public.organizations where id = m.organization_id)),
        'has_custom_quota', m.annual_leave_quota_days is not null) end,
    'stats', case when can_private then jsonb_build_object(
        'active_tasks', (select count(*) from public.task_occurrence_assignees a join public.task_occurrences o on o.id = a.occurrence_id
                         where a.user_id = p_user and o.status in ('todo', 'in_progress') and o.due_at <= now() + interval '30 days'),
        'completed_tasks', (select count(*) from public.task_occurrence_assignees a join public.task_occurrences o on o.id = a.occurrence_id
                            where a.user_id = p_user and o.status = 'completed')) end,
    'leave_this_week', case when can_private then exists (
        select 1 from public.leave_requests l where l.employee_id = p_user and l.status = 'approved'
        and tstzrange(l.start_at, l.end_at) && tstzrange(now(), now() + interval '7 days')) end,
    'recent_activity', case when can_private then coalesce((
        select jsonb_agg(x order by x ->> 'at' desc) from (
          select jsonb_build_object('kind', u.update_type, 'task_title', t.title, 'body', u.body, 'metadata', u.metadata, 'at', u.created_at) as x
          from public.task_updates u join public.task_occurrences o on o.id = u.occurrence_id join public.tasks t on t.id = o.task_id
          where u.author_id = p_user order by u.created_at desc limit 8) q), '[]'::jsonb)
      || coalesce((select jsonb_agg(jsonb_build_object('kind', 'availability', 'start_date', ar.start_date, 'at', ar.created_at))
          from (select * from public.availability_rules where employee_id = p_user order by created_at desc limit 3) ar), '[]'::jsonb) end
  ) into result
  from public.profiles p left join public.profile_private pp on pp.user_id = p.id
  where p.id = p_user;
  return result;
end;
$$;

-- Activity log («گزارش فعالیت‌ها»): readable labels, no redacted values, managers only.
create or replace function public.audit_feed(p_limit integer default 20, p_before bigint default null)
returns table (id bigint, action text, entity_type text, entity_id uuid, actor_name text, entity_label text, changed_fields jsonb, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org uuid := app.manager_org();
begin
  return query
  select a.id, a.action, a.entity_type, a.entity_id, coalesce(pa.full_name, 'سیستم'),
         case a.entity_type
           when 'tasks' then (select t.title from public.tasks t where t.id = a.entity_id)
           when 'task_occurrences' then (select t.title from public.task_occurrences o join public.tasks t on t.id = o.task_id where o.id = a.entity_id)
           when 'invoices' then (select i.title from public.invoices i where i.id = a.entity_id)
           when 'invoice_series' then (select s.title from public.invoice_series s where s.id = a.entity_id)
           when 'payment_records' then (select i.title from public.payment_records pr join public.invoices i on i.id = pr.invoice_id where pr.id = a.entity_id)
           when 'leave_requests' then (select pe.full_name from public.leave_requests l join public.profiles pe on pe.id = l.employee_id where l.id = a.entity_id)
           when 'organization_memberships' then (select pm.full_name from public.organization_memberships mm join public.profiles pm on pm.id = mm.user_id where mm.id = a.entity_id)
           when 'calendar_events' then (select e.title from public.calendar_events e where e.id = a.entity_id)
           when 'organizations' then (select o.name from public.organizations o where o.id = a.entity_id)
           else null end,
         a.changed_fields, a.created_at
  from public.audit_logs a
  left join public.profiles pa on pa.id = a.actor_user_id
  where a.organization_id = org and (p_before is null or a.id < p_before)
  order by a.id desc
  limit least(greatest(p_limit, 1), 100);
end;
$$;

revoke all on function public.team_directory(boolean), public.member_profile(uuid), public.audit_feed(integer, bigint) from public, anon;
grant execute on function public.team_directory(boolean), public.member_profile(uuid), public.audit_feed(integer, bigint) to authenticated;

-- Notification preferences row for members created before 0003 or via bootstrap.
insert into public.member_preferences (organization_id, user_id)
select organization_id, user_id from public.organization_memberships where status = 'active'
on conflict do nothing;
