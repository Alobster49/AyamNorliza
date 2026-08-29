-- Advance-notice rule for planned leave.
--
-- Annual leave is planned time off, so it must be booked at least a week
-- ahead: a request whose start_date is less than 7 calendar days from the
-- org's today is refused. Unplanned types (medical, hospitalization,
-- emergency, unpaid, paternity) require no notice and are unaffected.
--
-- Enforced here as well as in leave-model.ts's `validateApplication` for the
-- same reason 20260830000003 recomputes day_count in a trigger: `applyLeave`
-- is a plain insert, so a member can POST straight to PostgREST and book
-- annual leave for tomorrow if the only check lives in the Server Action.
-- The two implementations must stay in step — MIN_NOTICE_DAYS_BY_CODE in
-- leave-model.ts is the twin of `leave_min_notice_days` below.
--
-- The rule is deliberately absolute: no role, HR and owner included, may
-- submit short-notice annual leave. The escape hatch for a genuine emergency
-- is an emergency-leave request, which carries no notice requirement.
--
-- Calendar days, not workdays: "one week ahead" is what a member reads it as,
-- and a workday cutoff would silently drift with public holidays.

begin;

-- ---------------------------------------------------------------------------
-- Notice requirement by leave type code. Twin of MIN_NOTICE_DAYS_BY_CODE in
-- src/features/hr/lib/leave-model.ts.
-- ---------------------------------------------------------------------------
create or replace function public.leave_min_notice_days(p_code text)
returns int
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_code when 'annual' then 7 else 0 end;
$$;
revoke all on function public.leave_min_notice_days(text) from public;
grant execute on function public.leave_min_notice_days(text) to authenticated;
-- The insert trigger runs this as the inserting role; service-role inserts
-- (admin API, seeds) would otherwise fail with "permission denied" — same
-- reasoning as leave_workday_count in 20260830000003.
grant execute on function public.leave_min_notice_days(text) to service_role;

-- ---------------------------------------------------------------------------
-- Extends the 20260830000003 trigger: same cross-org leave_type_id guard and
-- server-side year/day_count, plus the notice check. Rewritten whole rather
-- than chained, so one function remains the single description of what a
-- valid leave_requests insert looks like.
--
-- "Today" comes from the org's own default_time_zone, never `current_date`:
-- Postgres runs in UTC and the depot runs on Malaysian time (UTC+8), so
-- between 00:00 and 08:00 MYT `current_date` is still yesterday and the
-- cutoff would be a day too lenient. Mirrors todayInTimeZone in
-- src/lib/time/org-date.ts.
-- ---------------------------------------------------------------------------
create or replace function public.leave_requests_before_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_type_org uuid;
  v_type_code text;
  v_notice int;
  v_today date;
begin
  select organization_id, code into v_type_org, v_type_code
  from public.leave_types where id = new.leave_type_id;

  if v_type_org is null or v_type_org <> new.organization_id then
    raise exception using errcode = 'P0001', message = 'validation';
  end if;

  new.year := extract(year from new.start_date)::int;
  new.day_count := public.leave_workday_count(new.organization_id, new.start_date, new.end_date);

  if new.day_count <= 0 then
    raise exception using errcode = 'P0001', message = 'validation';
  end if;

  v_notice := public.leave_min_notice_days(v_type_code);
  if v_notice > 0 then
    select (now() at time zone coalesce(o.default_time_zone, 'Asia/Kuala_Lumpur'))::date
      into v_today
    from public.organizations o
    where o.id = new.organization_id;

    if v_today is not null and new.start_date < v_today + v_notice then
      raise exception using errcode = 'P0001', message = 'insufficient_notice';
    end if;
  end if;

  return new;
end;
$$;

commit;
