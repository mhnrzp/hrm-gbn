-- 0009 private file storage: avatars (team-visible) and entity attachments (permission-checked, signed URLs).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 10485760,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Avatars: path "<org_id>/<user_id>/<file>". Co-members read; the user or a manager of the org writes.
create policy avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and app.is_active_member(((storage.foldername(name))[1])::uuid));
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and app.is_active_member(((storage.foldername(name))[1])::uuid)
              and ((storage.foldername(name))[2]::uuid = (select auth.uid()) or app.is_manager(((storage.foldername(name))[1])::uuid)));
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[2]::uuid = (select auth.uid()) or app.is_manager(((storage.foldername(name))[1])::uuid)));
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[2]::uuid = (select auth.uid()) or app.is_manager(((storage.foldername(name))[1])::uuid)));
-- The "attachments" bucket has no client policies: uploads and downloads only go through
-- short-lived signed URLs issued by the server after app.can_access_entity() passes.

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  owner_entity_type text not null check (owner_entity_type in ('invoice', 'task_occurrence', 'leave_request')),
  owner_entity_id uuid not null,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  uploaded_by uuid not null references public.profiles (id),
  confirmed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index attachments_owner_idx on public.attachments (owner_entity_type, owner_entity_id) where deleted_at is null;
create trigger attachments_audit after insert or update on public.attachments for each row execute function app.audit_row('file_name');

-- Same rules as the owning record: invoices → managers; task → can_see_occurrence; leave → employee or managers.
create or replace function app.can_access_entity(p_type text, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_type
    when 'invoice' then exists (select 1 from public.invoices i where i.id = p_id and app.is_manager(i.organization_id))
    when 'task_occurrence' then app.can_see_occurrence(p_id)
    when 'leave_request' then exists (select 1 from public.leave_requests l where l.id = p_id
                                      and ((l.employee_id = (select auth.uid()) and app.is_active_member(l.organization_id)) or app.is_manager(l.organization_id)))
    else false
  end;
$$;
revoke all on function app.can_access_entity(text, uuid) from public;
grant execute on function app.can_access_entity(text, uuid) to authenticated;

create or replace function app.entity_org(p_type text, p_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case p_type
    when 'invoice' then (select organization_id from public.invoices where id = p_id)
    when 'task_occurrence' then (select organization_id from public.task_occurrences where id = p_id)
    when 'leave_request' then (select organization_id from public.leave_requests where id = p_id)
  end;
$$;
revoke all on function app.entity_org(text, uuid) from public;

alter table public.attachments enable row level security;
revoke all on public.attachments from anon, authenticated;
grant select on public.attachments to authenticated;
create policy attachments_select on public.attachments for select to authenticated
  using (deleted_at is null and app.can_access_entity(owner_entity_type, owner_entity_id));

-- Register an upload slot after the permission check; the server then issues a signed upload URL for the path.
create or replace function public.prepare_attachment(p_type text, p_id uuid, p_file_name text, p_mime text, p_size bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.entity_org(p_type, p_id);
  path text;
  att public.attachments;
  allowed text[] := (select allowed_mime_types from storage.buckets where id = 'attachments');
begin
  if org is null or not app.can_access_entity(p_type, p_id) then perform app.fail('NOT_FOUND'); end if;
  if p_size > 10485760 then perform app.fail('FILE_TOO_LARGE'); end if;
  if not (p_mime = any (allowed)) then perform app.fail('FILE_TYPE_NOT_ALLOWED'); end if;
  path := org || '/' || p_type || '/' || p_id || '/' || gen_random_uuid();
  insert into public.attachments (organization_id, owner_entity_type, owner_entity_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values (org, p_type, p_id, path, left(regexp_replace(p_file_name, '[\\/\x00-\x1f]', '_', 'g'), 200), p_mime, p_size, auth.uid())
  returning * into att;
  return jsonb_build_object('attachment_id', att.id, 'storage_path', path);
end;
$$;

-- Returns the storage path only if the caller may read the attachment (server then signs a 60s URL).
create or replace function public.attachment_path(p_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  att public.attachments;
begin
  select * into att from public.attachments where id = p_id and deleted_at is null;
  if att.id is null or not app.can_access_entity(att.owner_entity_type, att.owner_entity_id) then perform app.fail('NOT_FOUND'); end if;
  return att.storage_path;
end;
$$;

create or replace function public.delete_attachment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  att public.attachments;
begin
  select * into att from public.attachments where id = p_id and deleted_at is null for update;
  if att.id is null or not app.can_access_entity(att.owner_entity_type, att.owner_entity_id)
     or not (att.uploaded_by = auth.uid() or app.is_manager(att.organization_id)) then
    perform app.fail('NOT_FOUND');
  end if;
  update public.attachments set deleted_at = now() where id = att.id;
end;
$$;

revoke all on function public.prepare_attachment(text, uuid, text, text, bigint), public.attachment_path(uuid), public.delete_attachment(uuid) from public, anon;
grant execute on function public.prepare_attachment(text, uuid, text, text, bigint), public.attachment_path(uuid), public.delete_attachment(uuid) to authenticated;
