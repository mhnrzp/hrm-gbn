-- 0010 background jobs (pg_cron → SQL). Every job is idempotent, overlap-safe (advisory xact lock),
-- and recorded in job_runs. They never depend on a browser being open.

create extension if not exists pg_cron with schema pg_catalog;

-- Run a job body with bookkeeping. Overlapping runs of the same job are skipped, not queued.
create or replace function app.run_job(p_name text, p_sql text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_id bigint;
  n integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('job:' || p_name)) then
    insert into public.job_runs (job_name, status, finished_at) values (p_name, 'skipped', now());
    return 0;
  end if;
  insert into public.job_runs (job_name) values (p_name) returning id into run_id;
  begin
    execute p_sql into n;
    update public.job_runs set status = 'succeeded', finished_at = now(), processed_count = coalesce(n, 0) where id = run_id;
  exception when others then
    update public.job_runs set status = 'failed', finished_at = now(), error_code = sqlstate where id = run_id;
  end;
  return coalesce(n, 0);
end;
$$;
revoke all on function app.run_job(text, text) from public;

-- Due-soon (per assignee preference) and overdue (once, on transition) task alerts.
create or replace function app.scan_task_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer := 0;
  r record;
begin
  -- due soon: per assignee, honouring task_reminder_enabled / task_reminder_days (default 1 day)
  for r in
    select o.id as occ, o.organization_id as org, o.due_at, t.title, a.user_id
    from public.task_occurrences o
    join public.tasks t on t.id = o.task_id
    join public.task_occurrence_assignees a on a.occurrence_id = o.id and a.progress_status <> 'completed'
    left join public.member_preferences p on p.organization_id = o.organization_id and p.user_id = a.user_id
    where o.status in ('todo', 'in_progress') and coalesce(p.task_reminder_enabled, true)
      and o.due_at > now() and o.due_at <= now() + make_interval(days => coalesce(p.task_reminder_days, 1))
  loop
    perform app.emit(r.org, 'task.due_soon', 'task_occurrence', r.occ, array[r.user_id], 'task.due_soon',
      jsonb_build_object('task_title', r.title, 'due_at', r.due_at), 'reminder', 'task.due_soon:' || r.occ || ':' || r.user_id);
    n := n + 1;
  end loop;

  -- overdue: assignees + creator, exactly once per occurrence (dedupe key has no time component)
  for r in
    select o.id as occ, o.organization_id as org, o.due_at, t.title, t.created_by,
           array(select a.user_id from public.task_occurrence_assignees a where a.occurrence_id = o.id) as users
    from public.task_occurrences o join public.tasks t on t.id = o.task_id
    where o.status in ('todo', 'in_progress') and o.due_at <= now() and o.due_at > now() - interval '30 days'
  loop
    perform app.emit(r.org, 'task.overdue', 'task_occurrence', r.occ, r.users || r.created_by, 'task.overdue',
      jsonb_build_object('task_title', r.title, 'due_at', r.due_at), 'critical', 'task.overdue:' || r.occ);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Invoice due-soon / overdue alerts for managers (per manager lead time), once per invoice per manager.
create or replace function app.scan_invoice_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer := 0;
  r record;
begin
  for r in
    select i.id, i.organization_id as org, i.title, i.amount_irr, i.due_date, m.user_id,
           (now() at time zone o.timezone)::date as today, coalesce(p.invoice_reminder_days, 3) as lead
    from public.invoices i
    join public.organizations o on o.id = i.organization_id
    join public.organization_memberships m on m.organization_id = i.organization_id and m.role = 'manager' and m.status = 'active'
    left join public.member_preferences p on p.organization_id = i.organization_id and p.user_id = m.user_id
    where i.payment_state = 'unpaid' and i.reminder_enabled and coalesce(p.invoice_reminder_enabled, true)
      and i.due_date <= (now() at time zone o.timezone)::date + coalesce(p.invoice_reminder_days, 3)
      and i.due_date >= (now() at time zone o.timezone)::date - 30
  loop
    if r.due_date < r.today then
      perform app.emit(r.org, 'invoice.overdue', 'invoice', r.id, array[r.user_id], 'invoice.overdue',
        jsonb_build_object('title', r.title, 'amount_irr', r.amount_irr::text, 'due_date', r.due_date), 'critical', 'invoice.overdue:' || r.id || ':' || r.user_id);
    else
      perform app.emit(r.org, 'invoice.due_soon', 'invoice', r.id, array[r.user_id], 'invoice.due_soon',
        jsonb_build_object('title', r.title, 'amount_irr', r.amount_irr::text, 'due_date', r.due_date), 'reminder', 'invoice.due_soon:' || r.id || ':' || r.user_id);
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- «خلاصه هفتگی تیم»: Saturdays from 08:00 org-local, for managers who enabled it; once per Jalali week.
create or replace function app.weekly_digest()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer := 0;
  o record;
  local_now timestamp;
  stats jsonb;
begin
  for o in select * from public.organizations loop
    local_now := now() at time zone o.timezone;
    continue when extract(dow from local_now) <> o.week_start or extract(hour from local_now) < 8;
    select jsonb_build_object(
      'open_tasks', (select count(*) from public.task_occurrences t where t.organization_id = o.id and t.status in ('todo', 'in_progress') and t.local_due_date <= local_now::date + 7),
      'overdue_tasks', (select count(*) from public.task_occurrences t where t.organization_id = o.id and t.status in ('todo', 'in_progress') and t.due_at < now()),
      'pending_leave', (select count(*) from public.leave_requests l where l.organization_id = o.id and l.status = 'pending'),
      'invoices_due', (select count(*) from public.invoices i where i.organization_id = o.id and i.payment_state = 'unpaid' and i.due_date <= local_now::date + 7))
    into stats;
    perform app.emit(o.id, 'digest.weekly', 'organization', o.id,
      array(select m.user_id from public.organization_memberships m
            join public.member_preferences p on p.organization_id = m.organization_id and p.user_id = m.user_id
            where m.organization_id = o.id and m.role = 'manager' and m.status = 'active' and p.weekly_digest_enabled),
      'digest.weekly', stats, 'general', 'digest.weekly:' || o.id || ':' || to_char(local_now::date, 'IYYY-IW'));
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Alert managers if any job failed repeatedly in the last day.
create or replace function app.job_health_check()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  failing text[];
  o record;
begin
  select array_agg(job_name) into failing from (
    select job_name from public.job_runs
    where status = 'failed' and started_at > now() - interval '24 hours'
    group by job_name having count(*) >= 3
  ) f;
  if failing is null then return 0; end if;
  for o in select id from public.organizations loop
    perform app.emit(o.id, 'system.job_failed', 'organization', o.id, app.org_managers(o.id), 'system.job_failed',
      jsonb_build_object('jobs', to_jsonb(failing)), 'critical', 'system.job_failed:' || o.id || ':' || current_date);
  end loop;
  delete from public.job_runs where started_at < now() - interval '30 days';
  return cardinality(failing);
end;
$$;

revoke all on function app.scan_task_reminders(), app.scan_invoice_reminders(), app.weekly_digest(), app.job_health_check() from public;

select cron.schedule('process_outbox', '30 seconds', $$select app.run_job('process_outbox', 'select app.process_outbox()')$$);
select cron.schedule('generate_task_occurrences', '7 * * * *', $$select app.run_job('generate_task_occurrences', 'select app.generate_task_occurrences()')$$);
select cron.schedule('scan_task_reminders', '15 * * * *', $$select app.run_job('scan_task_reminders', 'select app.scan_task_reminders()')$$);
select cron.schedule('scan_invoice_reminders', '20 * * * *', $$select app.run_job('scan_invoice_reminders', 'select app.scan_invoice_reminders()')$$);
select cron.schedule('weekly_digest', '25 * * * *', $$select app.run_job('weekly_digest', 'select app.weekly_digest()')$$);
select cron.schedule('generate_invoice_occurrences', '40 0 * * *', $$select app.run_job('generate_invoice_occurrences', 'select app.generate_invoice_occurrences()')$$);
select cron.schedule('generate_availability_occurrences', '45 0 * * *', $$select app.run_job('generate_availability_occurrences', 'select app.generate_availability_occurrences()')$$);
select cron.schedule('job_health_check', '50 0 * * *', $$select app.run_job('job_health_check', 'select app.job_health_check()')$$);
