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

-- ── Jalali (Persian) calendar, port of the jalaali-js algorithm (Borkowski breaks) ──
-- Monthly recurrence and leave-year boundaries follow the organisation's Jalali calendar.

-- 1 Farvardin of Jalali year jy as a Gregorian date, plus whether jy is a leap year.
create or replace function app.jalali_year_start(jy integer, out farvardin1 date, out is_leap boolean)
language plpgsql
immutable
set search_path = ''
as $$
declare
  breaks integer[] := array[-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
  gy integer := jy + 621;
  leap_j integer := -14;
  jp integer := breaks[1];
  jm integer;
  jump integer := 0;
  n integer;
  leap_g integer;
  march integer;
  leap integer;
  i integer;
begin
  if jy < breaks[1] or jy >= breaks[array_length(breaks, 1)] then
    raise exception 'jalali year out of range: %', jy;
  end if;
  for i in 2 .. array_length(breaks, 1) loop
    jm := breaks[i];
    jump := jm - jp;
    exit when jy < jm;
    leap_j := leap_j + ((jump) / (33)) * 8 + ((mod(jump, 33)) / (4));
    jp := jm;
  end loop;
  n := jy - jp;
  leap_j := leap_j + ((n) / (33)) * 8 + ((mod(n, 33) + 3) / (4));
  if mod(jump, 33) = 4 and jump - n = 4 then leap_j := leap_j + 1; end if;
  leap_g := (gy / 4) - ((gy / 100 + 1) * 3) / 4 - 150;
  march := 20 + leap_j - leap_g;
  if jump - n < 6 then n := n - jump + ((jump + 4) / (33)) * 33; end if;
  leap := mod(mod(n + 1, 33) - 1, 4);
  if leap = -1 then leap := 4; end if;
  farvardin1 := make_date(gy, 3, march);
  is_leap := (leap = 0);
end;
$$;

create or replace function app.jalali_month_length(jy integer, jm integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when jm <= 6 then 31 when jm <= 11 then 30 when (app.jalali_year_start(jy)).is_leap then 30 else 29 end;
$$;

create or replace function app.from_jalali(jy integer, jm integer, jd integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select (app.jalali_year_start(jy)).farvardin1 + ((jm - 1) * 31 - ((jm) / (7)) * (jm - 7) + jd - 1);
$$;

-- Gregorian date → {jy, jm, jd}
create or replace function app.to_jalali(d date, out jy integer, out jm integer, out jd integer)
language plpgsql
immutable
set search_path = ''
as $$
declare
  k integer;
begin
  jy := extract(year from d)::int - 621;
  k := d - (app.jalali_year_start(jy)).farvardin1;
  if k < 0 then
    jy := jy - 1;
    k := d - (app.jalali_year_start(jy)).farvardin1;
  end if;
  if k <= 185 then
    jm := 1 + ((k) / (31));
    jd := mod(k, 31) + 1;
  else
    k := k - 186;
    jm := 7 + ((k) / (30));
    jd := mod(k, 30) + 1;
  end if;
end;
$$;

-- Same Jalali day-of-month as `anchor`, `months` Jalali months later; clamped to the month's last day.
create or replace function app.add_jalali_months(anchor date, months integer)
returns date
language sql
immutable
set search_path = ''
as $$
  with a as (select (app.to_jalali(anchor)).*),
       t as (select a.jd, a.jy + ((a.jm - 1 + months) / (12)) as ty, mod(a.jm - 1 + months, 12) + 1 as tm from a)
  select app.from_jalali(t.ty, t.tm, least(t.jd, app.jalali_month_length(t.ty, t.tm))) from t;
$$;

revoke all on all functions in schema app from public;
grant execute on function app.request_id() to authenticated, service_role;
grant execute on function app.fail(text, jsonb) to authenticated, service_role;
