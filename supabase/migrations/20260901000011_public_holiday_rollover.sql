-- Stop `leave_workday_count` from silently over-counting when a year's public
-- holidays are missing, and give new organizations a calendar at all.
--
-- `public_holidays` was populated once, for 2026 only, by a backfill in
-- 20260830000001 that read `select ... from public.organizations`. Two silent
-- failures follow:
--
--   1. From 1 January 2027 no row matches any date, so every weekday counts as
--      a workday and leave deducts more days than it should. Nothing raises.
--      A leave system that is quietly wrong about balances is worse than one
--      that refuses to answer.
--   2. That backfill only ever ran for the organizations that existed when the
--      migration was applied. Any organization created since has no holidays
--      at all and is already counting wrongly today — verified against a fresh
--      org before writing this.
--
-- The dates themselves cannot be generated. Roughly half the Malaysian
-- calendar is lunar or Islamic, and the observed dates are federal
-- proclamations rather than anything derivable, so a future year has to be
-- entered by a person. Guessing them here would reintroduce exactly the bug
-- being fixed, only harder to notice.
--
-- So this migration does the two things that can be done correctly:
--
--   * seeds the national calendar into new organizations, via a trigger
--     alongside `organizations_seed_roles`, and backfills any organization
--     that missed the original one-off insert;
--   * makes `leave_workday_count` raise `holidays_not_configured` when the
--     requested range touches a year the organization has no holidays for,
--     instead of returning a confident wrong number.
--
-- Consequence, stated plainly: on 1 January 2027 leave applications begin
-- failing with `holidays_not_configured` until someone adds the 2027 dates.
-- That is deliberate. HR already has the tools — `addHoliday` / `deleteHoliday`
-- in src/features/hr/server/manage-actions.ts back the holiday editor on the
-- leave management page — so the block is self-service and the error names its
-- own remedy. The alternative is silently wrong balances nobody catches until
-- someone audits a payslip.

begin;

-- ---------------------------------------------------------------------------
-- 1. The national calendar, as a function so it has one home.
--
-- Add future years here as they are gazetted; re-running is idempotent, so
-- calling it again after an edit backfills every organization.
-- ---------------------------------------------------------------------------
create or replace function public.seed_public_holidays(target_org uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.public_holidays (organization_id, holiday_date, name)
  select target_org, h.d::date, h.n
  from (values
    ('2026-01-01','New Year''s Day'), ('2026-02-17','Chinese New Year'),
    ('2026-02-18','Chinese New Year (2nd day)'), ('2026-03-21','Hari Raya Puasa'),
    ('2026-03-22','Hari Raya Puasa (2nd day)'), ('2026-05-01','Labour Day'),
    ('2026-05-27','Hari Raya Haji'), ('2026-05-31','Wesak Day'),
    ('2026-06-01','Agong''s Birthday'), ('2026-06-17','Awal Muharram'),
    ('2026-08-25','Prophet Muhammad''s Birthday'), ('2026-08-31','Merdeka Day'),
    ('2026-09-16','Malaysia Day'), ('2026-11-08','Deepavali'),
    ('2026-12-25','Christmas Day')
  ) as h(d, n)
  on conflict (organization_id, holiday_date, name) do nothing;
$$;

revoke all on function public.seed_public_holidays(uuid) from public, anon, authenticated;

comment on function public.seed_public_holidays(uuid) is
  'Seeds the Malaysian national public holidays for one organization. Idempotent. Add newly gazetted years to the body, then re-run for every org.';

-- ---------------------------------------------------------------------------
-- 2. New organizations get the calendar, the way they already get roles.
-- ---------------------------------------------------------------------------
create or replace function public.organizations_seed_holidays() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.seed_public_holidays(new.id);
  return new;
end $$;

drop trigger if exists organizations_seed_holidays on public.organizations;
create trigger organizations_seed_holidays after insert on public.organizations
  for each row execute function public.organizations_seed_holidays();

-- Catch up any organization created after the one-off backfill.
do $$
declare o record;
begin
  for o in select id from public.organizations loop
    perform public.seed_public_holidays(o.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Refuse to count across a year nobody has configured.
--
-- Becomes plpgsql to raise; the counting itself is unchanged. Every year the
-- range touches is checked, not just the start year, so a request running from
-- a configured December into an unconfigured January is caught rather than
-- half-counted.
-- ---------------------------------------------------------------------------
create or replace function public.leave_workday_count(p_org uuid, p_start date, p_end date)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer;
begin
  for v_year in
    select generate_series(extract(year from p_start)::int, extract(year from p_end)::int)
  loop
    if not exists (
      select 1 from public.public_holidays h
      where h.organization_id = p_org
        and extract(year from h.holiday_date)::int = v_year
    ) then
      raise exception using errcode = 'P0001', message = 'holidays_not_configured';
    end if;
  end loop;

  return (
    select coalesce(count(*), 0)::numeric
    from generate_series(p_start, p_end, interval '1 day') as d(day)
    where extract(isodow from d.day) < 6  -- 1..5 = Mon..Fri
      and not exists (
        select 1 from public.public_holidays h
        where h.organization_id = p_org and h.holiday_date = d.day::date
      )
  );
end $$;

comment on function public.leave_workday_count(uuid, date, date) is
  'Workdays between two dates, Mon-Fri minus that org''s public holidays. Raises holidays_not_configured when any year in the range has no holidays on file, rather than counting every weekday and returning a wrong number.';

commit;
