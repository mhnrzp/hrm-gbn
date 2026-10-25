-- 0002 organisations, profiles, memberships, invitations + membership helpers used by every RLS policy.

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  registration_code text check (char_length(registration_code) <= 40),
  email text check (char_length(email) <= 254),
  phone text check (char_length(phone) <= 32),
  address text check (char_length(address) <= 500),
  timezone text not null default 'Asia/Tehran',
  week_start smallint not null default 6 check (week_start between 0 and 6),          -- 6 = Saturday (extract(dow))
  weekend_days smallint[] not null default '{5}',                                       -- 5 = Friday
  default_leave_quota_days numeric(5, 1) not null default 26 check (default_leave_quota_days between 0 and 366),
  default_currency text not null default 'IRR' check (default_currency = 'IRR'),
  display_currency_unit text not null default 'toman' check (display_currency_unit in ('toman', 'rial')),
  locale text not null default 'fa-IR' check (locale = 'fa-IR'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function app.validate_org()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    perform app.fail('INVALID_TIMEZONE');
  end if;
  if exists (select 1 from unnest(new.weekend_days) d where d not between 0 and 6) then
    perform app.fail('VALIDATION_FAILED', '{"field":"weekend_days"}');
  end if;
  return new;
end;
$$;

create trigger organizations_validate before insert or update on public.organizations
  for each row execute function app.validate_org();
create trigger organizations_updated_at before update on public.organizations
  for each row execute function app.set_updated_at();

-- Public-facing profile fields (visible to co-members). Private contact data lives in profile_private.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  full_name text not null default '' check (char_length(full_name) <= 120),
  avatar_path text check (char_length(avatar_path) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function app.set_updated_at();

create table public.profile_private (
  user_id uuid primary key references public.profiles (id) on delete restrict,
  email text not null,
  phone text check (char_length(phone) <= 32),
  updated_at timestamptz not null default now()
);
create trigger profile_private_updated_at before update on public.profile_private
  for each row execute function app.set_updated_at();

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  user_id uuid not null references public.profiles (id),
  role text not null check (role in ('manager', 'employee')),
  job_title text not null default '' check (char_length(job_title) <= 120),
  status text not null default 'invited' check (status in ('invited', 'active', 'inactive')),
  work_mode text not null default 'office' check (work_mode in ('office', 'remote')),
  manager_id uuid references public.profiles (id),
  annual_leave_quota_days numeric(5, 1) check (annual_leave_quota_days between 0 and 366),
  joined_at date,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (organization_id, id),
  check ((status = 'inactive') = (deactivated_at is not null))
);
create index organization_memberships_user_idx on public.organization_memberships (user_id, status);
create trigger organization_memberships_updated_at before update on public.organization_memberships
  for each row execute function app.set_updated_at();

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  user_id uuid not null references public.profiles (id),
  invited_email text not null,
  role text not null check (role in ('manager', 'employee')),
  invited_by uuid references public.profiles (id),
  email_sent boolean not null default true,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index invitations_user_idx on public.invitations (user_id) where accepted_at is null and revoked_at is null;

-- ── Membership helpers (security definer to avoid RLS recursion on organization_memberships) ──

create or replace function app.is_active_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.organization_id = org and m.user_id = (select auth.uid()) and m.status = 'active'
  );
$$;

create or replace function app.is_manager(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.organization_id = org and m.user_id = (select auth.uid()) and m.status = 'active' and m.role = 'manager'
  );
$$;

-- Caller is active in some org that `other` belongs to (any status, so history stays readable).
create or replace function app.shares_org(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships me
    join public.organization_memberships them on them.organization_id = me.organization_id
    where me.user_id = (select auth.uid()) and me.status = 'active' and them.user_id = other
  );
$$;

-- Caller is an active manager of some org that `other` belongs to.
create or replace function app.manages_user(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships me
    join public.organization_memberships them on them.organization_id = me.organization_id
    where me.user_id = (select auth.uid()) and me.status = 'active' and me.role = 'manager' and them.user_id = other
  );
$$;

-- `uid` is an active member of `org` (used to validate assignees, attendees, …).
create or replace function app.is_active_member_user(org uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.organization_id = org and m.user_id = uid and m.status = 'active'
  );
$$;

revoke all on function app.is_active_member(uuid), app.is_manager(uuid), app.shares_org(uuid), app.manages_user(uuid), app.is_active_member_user(uuid, uuid) from public;
grant execute on function app.is_active_member(uuid), app.is_manager(uuid), app.shares_org(uuid), app.manages_user(uuid), app.is_active_member_user(uuid, uuid) to authenticated, service_role;

-- ── New auth user → profile rows ──

create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120));
  insert into public.profile_private (user_id, email) values (new.id, coalesce(new.email, ''));
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

create or replace function app.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profile_private set email = coalesce(new.email, '') where user_id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function app.handle_user_email_change();

-- ── RLS ──

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_private enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.invitations enable row level security;

revoke all on public.organizations, public.profiles, public.profile_private, public.organization_memberships, public.invitations from anon, authenticated;

grant select on public.organizations to authenticated;
grant update (name, registration_code, email, phone, address, timezone, week_start, weekend_days, default_leave_quota_days, display_currency_unit)
  on public.organizations to authenticated;
create policy organizations_select on public.organizations for select to authenticated
  using (app.is_active_member(id));
create policy organizations_update on public.organizations for update to authenticated
  using (app.is_manager(id)) with check (app.is_manager(id));

grant select on public.profiles to authenticated;
grant update (full_name, avatar_path) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or app.shares_org(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or app.manages_user(id))
  with check (id = (select auth.uid()) or app.manages_user(id));

grant select on public.profile_private to authenticated;
grant update (phone) on public.profile_private to authenticated;
create policy profile_private_select on public.profile_private for select to authenticated
  using (user_id = (select auth.uid()) or app.manages_user(user_id));
create policy profile_private_update on public.profile_private for update to authenticated
  using (user_id = (select auth.uid()) or app.manages_user(user_id))
  with check (user_id = (select auth.uid()) or app.manages_user(user_id));

-- Leave quota is private: not selectable directly (exposed through leave_balance()).
grant select (id, organization_id, user_id, role, job_title, status, work_mode, manager_id, joined_at, deactivated_at, created_at, updated_at)
  on public.organization_memberships to authenticated;
create policy memberships_select on public.organization_memberships for select to authenticated
  using (user_id = (select auth.uid()) or app.is_active_member(organization_id));

grant select on public.invitations to authenticated;
create policy invitations_select on public.invitations for select to authenticated
  using (app.is_manager(organization_id));
