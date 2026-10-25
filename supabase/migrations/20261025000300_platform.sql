-- 0003 preferences, notifications, outbox, audit log, job runs + member management RPCs.

create table public.member_preferences (
  organization_id uuid not null references public.organizations (id),
  user_id uuid not null references public.profiles (id),
  in_app_enabled boolean not null default true,
  email_enabled boolean not null default false,
  notify_leave_requests boolean not null default true,
  notify_task_status boolean not null default false,
  task_reminder_enabled boolean not null default true,
  task_reminder_days smallint not null default 1 check (task_reminder_days between 0 and 30),
  invoice_reminder_enabled boolean not null default true,
  invoice_reminder_days smallint not null default 3 check (invoice_reminder_days between 0 and 60),
  weekly_digest_enabled boolean not null default false,
  compact_tables boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create trigger member_preferences_updated_at before update on public.member_preferences
  for each row execute function app.set_updated_at();

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  recipient_user_id uuid not null references public.profiles (id),
  type text not null,
  entity_type text not null,
  entity_id uuid,
  title_key text not null,
  message_data jsonb not null default '{}',
  is_read boolean not null default false,
  read_at timestamptz,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  unique (recipient_user_id, dedupe_key)
);
create index notifications_inbox_idx on public.notifications (recipient_user_id, is_read, created_at desc);

create or replace function app.stamp_read_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.read_at := case when new.is_read then coalesce(old.read_at, now()) else null end;
  return new;
end;
$$;
create trigger notifications_read_at before update of is_read on public.notifications
  for each row execute function app.stamp_read_at();

create table public.outbox_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  payload jsonb not null default '{}',
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error_code text
);
create index outbox_pending_idx on public.outbox_events (next_attempt_at) where processed_at is null;

create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations (id),
  actor_user_id uuid references public.profiles (id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  request_id text,
  changed_fields jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_logs_org_idx on public.audit_logs (organization_id, created_at desc);

create table public.job_runs (
  id bigint generated always as identity primary key,
  job_name text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'skipped')),
  processed_count integer not null default 0,
  error_code text
);
create index job_runs_name_idx on public.job_runs (job_name, started_at desc);

-- Emit an outbox event inside the caller's transaction (deduplicated).
create or replace function app.emit(org uuid, event_type text, entity_type text, entity_id uuid, payload jsonb, dedupe_key text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.outbox_events (organization_id, event_type, entity_type, entity_id, payload, dedupe_key)
  values (org, event_type, entity_type, entity_id, coalesce(payload, '{}'), dedupe_key)
  on conflict (dedupe_key) do nothing;
$$;
revoke all on function app.emit(uuid, text, text, uuid, jsonb, text) from public;

-- Generic append-only audit trail. TG_ARGV[0] = comma-separated columns whose values are redacted.
create or replace function app.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  redacted text[] := string_to_array(coalesce(tg_argv[0], ''), ',');
  new_j jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  old_j jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  cur jsonb := coalesce(new_j, old_j);
  changed jsonb := '{}';
  k text;
  org uuid;
begin
  for k in select jsonb_object_keys(cur) loop
    continue when k in ('created_at', 'updated_at');
    continue when tg_op = 'UPDATE' and (new_j -> k) is not distinct from (old_j -> k);
    continue when tg_op = 'INSERT' and (new_j -> k) = 'null'::jsonb;
    changed := changed || jsonb_build_object(k, case when k = any (redacted) then '"[redacted]"'::jsonb else cur -> k end);
  end loop;
  if tg_op = 'UPDATE' and changed = '{}'::jsonb then
    return null;
  end if;
  org := case when tg_table_name = 'organizations' then (cur ->> 'id')::uuid else (cur ->> 'organization_id')::uuid end;
  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, request_id, changed_fields)
  values (org, auth.uid(), tg_table_name || '.' || lower(tg_op), tg_table_name, coalesce(cur ->> 'id', cur ->> 'user_id')::uuid, app.request_id(), changed);
  return null;
end;
$$;

create trigger organizations_audit after insert or update on public.organizations
  for each row execute function app.audit_row();
create trigger memberships_audit after insert or update on public.organization_memberships
  for each row execute function app.audit_row();
create trigger invitations_audit after insert or update on public.invitations
  for each row execute function app.audit_row('invited_email');
create trigger profiles_audit after update on public.profiles
  for each row execute function app.audit_row();
create trigger profile_private_audit after update on public.profile_private
  for each row execute function app.audit_row('email,phone');

-- ── RLS ──

alter table public.member_preferences enable row level security;
alter table public.notifications enable row level security;
alter table public.outbox_events enable row level security;
alter table public.audit_logs enable row level security;
alter table public.job_runs enable row level security;

revoke all on public.member_preferences, public.notifications, public.outbox_events, public.audit_logs, public.job_runs from anon, authenticated;

grant select, insert on public.member_preferences to authenticated;
grant update (in_app_enabled, email_enabled, notify_leave_requests, notify_task_status, task_reminder_enabled, task_reminder_days,
  invoice_reminder_enabled, invoice_reminder_days, weekly_digest_enabled, compact_tables) on public.member_preferences to authenticated;
create policy member_preferences_own on public.member_preferences for all to authenticated
  using (user_id = (select auth.uid()) and app.is_active_member(organization_id))
  with check (user_id = (select auth.uid()) and app.is_active_member(organization_id));

grant select on public.notifications to authenticated;
grant update (is_read) on public.notifications to authenticated;
create policy notifications_own_select on public.notifications for select to authenticated
  using (recipient_user_id = (select auth.uid()) and app.is_active_member(organization_id));
create policy notifications_own_update on public.notifications for update to authenticated
  using (recipient_user_id = (select auth.uid()) and app.is_active_member(organization_id))
  with check (recipient_user_id = (select auth.uid()));

grant select on public.audit_logs to authenticated;
create policy audit_logs_manager on public.audit_logs for select to authenticated
  using (organization_id is not null and app.is_manager(organization_id));
-- outbox_events and job_runs: no grants to clients at all.

-- ── Member management RPCs ──

-- Invited user completes sign-up: invited → active.
create or replace function public.accept_invitation()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  inv public.invitations;
  mem_id uuid;
begin
  if uid is null then perform app.fail('UNAUTHENTICATED'); end if;

  select * into inv from public.invitations
  where user_id = uid and accepted_at is null and revoked_at is null
  order by created_at desc limit 1
  for update;

  if inv.id is null then
    -- Already accepted earlier: idempotent success if an active membership exists.
    select id into mem_id from public.organization_memberships where user_id = uid and status = 'active' limit 1;
    if mem_id is null then perform app.fail('INVITATION_INVALID'); end if;
    return mem_id;
  end if;
  if inv.expires_at < now() then perform app.fail('INVITATION_EXPIRED'); end if;

  update public.invitations set accepted_at = now() where id = inv.id;
  update public.organization_memberships
    set status = 'active', joined_at = coalesce(joined_at, current_date)
    where organization_id = inv.organization_id and user_id = uid and status = 'invited'
    returning id into mem_id;
  if mem_id is null then perform app.fail('MEMBER_INACTIVE'); end if;

  insert into public.member_preferences (organization_id, user_id) values (inv.organization_id, uid) on conflict do nothing;
  return mem_id;
end;
$$;
revoke all on function public.accept_invitation() from public, anon;
grant execute on function public.accept_invitation() to authenticated;

-- Server-only (service role) after the API verified the caller is a manager and created the auth user.
create or replace function public.register_invited_member(
  p_org uuid, p_user uuid, p_invited_by uuid, p_email text, p_role text, p_full_name text,
  p_job_title text, p_phone text, p_joined_at date, p_email_sent boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  mem_id uuid;
begin
  if not exists (select 1 from public.organization_memberships where organization_id = p_org and user_id = p_invited_by and role = 'manager' and status = 'active') then
    perform app.fail('FORBIDDEN');
  end if;
  if exists (select 1 from public.organization_memberships where organization_id = p_org and user_id = p_user) then
    perform app.fail('MEMBER_EXISTS');
  end if;

  update public.profiles set full_name = p_full_name where id = p_user;
  update public.profile_private set phone = nullif(p_phone, '') where user_id = p_user;

  insert into public.organization_memberships (organization_id, user_id, role, job_title, status, joined_at, manager_id)
  values (p_org, p_user, p_role, coalesce(p_job_title, ''), 'invited', p_joined_at, p_invited_by)
  returning id into mem_id;

  insert into public.invitations (organization_id, user_id, invited_email, role, invited_by, email_sent)
  values (p_org, p_user, lower(p_email), p_role, p_invited_by, p_email_sent);

  perform app.emit(p_org, 'team.member_invited', 'membership', mem_id,
    jsonb_build_object('member_name', p_full_name, 'invited_by', p_invited_by), 'team.member_invited:' || mem_id);
  return mem_id;
end;
$$;
revoke all on function public.register_invited_member(uuid, uuid, uuid, text, text, text, text, text, date, boolean) from public, anon, authenticated;
grant execute on function public.register_invited_member(uuid, uuid, uuid, text, text, text, text, text, date, boolean) to service_role;

-- Manager edits a member. Only allow-listed fields; never trusts role/status from employees.
create or replace function public.update_member(p_member_id uuid, p_patch jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.organization_memberships;
  new_role text;
  new_status text;
  remaining_managers integer;
begin
  select * into m from public.organization_memberships where id = p_member_id for update;
  if m.id is null or not app.is_manager(m.organization_id) then perform app.fail('NOT_FOUND'); end if;

  if exists (select 1 from jsonb_object_keys(p_patch) k where k not in
    ('role', 'job_title', 'status', 'work_mode', 'manager_id', 'annual_leave_quota_days', 'joined_at', 'full_name', 'phone')) then
    perform app.fail('VALIDATION_FAILED', '{"reason":"unknown_field"}');
  end if;

  new_role := coalesce(p_patch ->> 'role', m.role);
  new_status := coalesce(p_patch ->> 'status', m.status);
  if new_status not in ('active', 'inactive') and new_status <> m.status then perform app.fail('VALIDATION_FAILED', '{"field":"status"}'); end if;

  -- Never leave the organisation without an active manager.
  if m.role = 'manager' and m.status = 'active' and (new_role <> 'manager' or new_status <> 'active') then
    select count(*) into remaining_managers from public.organization_memberships
      where organization_id = m.organization_id and role = 'manager' and status = 'active' and id <> m.id;
    if remaining_managers = 0 then perform app.fail('LAST_MANAGER'); end if;
  end if;

  if p_patch ? 'manager_id' and p_patch ->> 'manager_id' is not null
     and not app.is_active_member_user(m.organization_id, (p_patch ->> 'manager_id')::uuid) then
    perform app.fail('MEMBER_INACTIVE');
  end if;

  update public.organization_memberships set
    role = new_role,
    status = new_status,
    deactivated_at = case when new_status = 'inactive' then coalesce(m.deactivated_at, now()) else null end,
    job_title = coalesce(p_patch ->> 'job_title', job_title),
    work_mode = coalesce(p_patch ->> 'work_mode', work_mode),
    manager_id = case when p_patch ? 'manager_id' then (p_patch ->> 'manager_id')::uuid else manager_id end,
    annual_leave_quota_days = case when p_patch ? 'annual_leave_quota_days' then (p_patch ->> 'annual_leave_quota_days')::numeric else annual_leave_quota_days end,
    joined_at = case when p_patch ? 'joined_at' then (p_patch ->> 'joined_at')::date else joined_at end
  where id = m.id;

  if p_patch ? 'full_name' then update public.profiles set full_name = p_patch ->> 'full_name' where id = m.user_id; end if;
  if p_patch ? 'phone' then update public.profile_private set phone = nullif(p_patch ->> 'phone', '') where user_id = m.user_id; end if;

  if new_status = 'inactive' and m.status <> 'inactive' then
    perform app.emit(m.organization_id, 'team.member_deactivated', 'membership', m.id, '{}'::jsonb, 'team.member_deactivated:' || m.id || ':' || now());
  end if;
  return m.id;
end;
$$;
revoke all on function public.update_member(uuid, jsonb) from public, anon;
grant execute on function public.update_member(uuid, jsonb) to authenticated;
