// Offline Postgres (PGlite) with the minimum Supabase surface our migrations rely on:
// roles, auth.users + auth.uid(), storage + cron stubs, default grants. Lets RLS and RPC logic
// be tested without Docker; concurrency and real Auth are covered by tests/integration against Supabase.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const SUPABASE_STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema extensions;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}',
  created_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz default now());
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;

create schema cron;
create table cron.job (jobname text primary key, schedule text, command text);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
  insert into cron.job values (job_name, schedule, command) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command;
  select 1::bigint;
$$;
create function cron.unschedule(job_name text) returns boolean language sql as $$ delete from cron.job where jobname = job_name; select true; $$;
`;

const MIGRATIONS_DIR = path.join(import.meta.dirname, "..", "..", "supabase", "migrations");

export async function createDb() {
  const db = await PGlite.create({ extensions: { btree_gist, pgcrypto } });
  await db.exec(SUPABASE_STUBS);
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8")
      // pg_cron is provided by Supabase, stubbed above.
      .replace(/create extension if not exists pg_cron[^;]*;/gi, "");
    try {
      await db.exec(sql);
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
  return db;
}

export type Db = PGlite;

let userSeq = 0;

export async function createUser(db: Db, fullName: string, email?: string): Promise<string> {
  userSeq += 1;
  const id = crypto.randomUUID();
  await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [id, email ?? `user${userSeq}@example.test`, { full_name: fullName }]);
  return id;
}

/** Run queries as a signed-in Supabase user (role authenticated, auth.uid() = userId). */
export async function asUser<T>(db: Db, userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.exec(userId ? "set role authenticated" : "set role anon");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

/** Expect a business error code raised by app.fail(). */
export async function expectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (err) {
    const message = (err as Error).message;
    if (message === code || message.includes(code)) return;
    throw new Error(`Expected ${code}, got: ${message}`);
  }
  throw new Error(`Expected ${code}, but the call succeeded`);
}

/** Seed one organisation with a manager and employees directly (superuser, like the bootstrap script). */
export async function seedOrg(db: Db, opts: { slug: string; employees?: string[] }) {
  const org = (await db.query<{ id: string }>("insert into public.organizations (name, slug) values ($1, $2) returning id", [`Org ${opts.slug}`, opts.slug])).rows[0].id;
  const manager = await createUser(db, `Manager ${opts.slug}`);
  await db.query("insert into public.organization_memberships (organization_id, user_id, role, status, joined_at) values ($1, $2, 'manager', 'active', current_date)", [org, manager]);
  const employees: string[] = [];
  for (const name of opts.employees ?? []) {
    const uid = await createUser(db, name);
    await db.query("insert into public.organization_memberships (organization_id, user_id, role, status, joined_at, job_title) values ($1, $2, 'employee', 'active', current_date, 'Developer')", [org, uid]);
    employees.push(uid);
  }
  return { org, manager, employees };
}
