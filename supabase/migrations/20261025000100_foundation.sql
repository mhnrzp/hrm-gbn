-- 0001 foundation: extensions, private helper schema, shared triggers.
-- Conventions
--   * Business errors: RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '<ERROR_CODE>', DETAIL = '<json>'.
--     lib/errors.ts maps the code to HTTP status + Persian message.
--   * Helpers live in schema "app" (not exposed through the Data API). Callable RPCs live in "public".
--   * Every security definer function pins search_path = '' and fully qualifies names.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- updated_at maintenance
create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Raise a typed business error the API layer understands.
create or replace function app.fail(code text, details jsonb default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = code, detail = coalesce(details::text, '');
end;
$$;

-- Request id forwarded by the API (x-request-id header) for audit correlation.
create or replace function app.request_id()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(coalesce(current_setting('request.headers', true), '{}')::json ->> 'x-request-id', '');
$$;

revoke all on all functions in schema app from public;
grant execute on function app.request_id() to authenticated, service_role;
grant execute on function app.fail(text, jsonb) to authenticated, service_role;
