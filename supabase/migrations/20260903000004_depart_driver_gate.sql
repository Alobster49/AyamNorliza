-- Gate departure on somebody actually being rostered to drive.
--
-- 20260903000001 gave trucks a regular driver and a per-day cover, and the
-- roster grid flags a "gap" when the planned driver is on approved leave.
-- Nothing downstream knew about it: dispatch would plan onto that truck, the
-- loading bay would load it, and the run would depart with nobody to drive
-- it. The dispatch and loading boards now warn in red; this is the hard stop
-- behind the warning, on the two office-side ways out of the yard:
--   * dispatch_depart_truck (20260814000001, refreshed by 20260820000002 and
--     20260828000002)
--   * set_run_status('departed') (20260820000002, refreshed by 20260828000002)
--
-- `planned` follows the roster's own precedence, matching truckDutyOn() in
-- src/features/logistics/lib/roster-model.ts:
--     cover ?? run driver ?? truck's regular driver
-- and the gate fires only when that person is on APPROVED leave for the run
-- date. Two deliberate non-cases:
--   * pending leave -- the roster calls that a risk, not a gap: the office can
--     still send them out, so it must not block.
--   * no driver resolved at all -- an org that has not filled in the roster
--     would otherwise have every truck stranded at the gate. That case stays
--     warn-only on the boards.
-- driver_start_run needs no equivalent: a driver starting their own run is
-- proof of a driver.
--
-- Everything else in both functions is copied wholesale from their CURRENT
-- definitions -- set_run_status from 20260901000010 (has_permission + the
-- failed-stop release before the delivered sweep) and dispatch_depart_truck
-- from 20260901000002 (has_permission) -- not from the older
-- 20260828000002 bodies, which still had the static has_org_role lists and
-- no failed-stop handling.

begin;

-- ---------------------------------------------------------------------------
-- Who is expected to drive p_truck on p_date, or null when nobody is.
-- Mirrors truckDutyOn(): cover, else the run's own driver, else the regular.
-- ---------------------------------------------------------------------------
create or replace function public.planned_driver_for(p_truck uuid, p_date date)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select c.driver_id from public.truck_covers c
      where c.truck_id = p_truck and c.cover_date = p_date),
    (select r.driver_id from public.delivery_runs r
      where r.truck_id = p_truck and r.run_date = p_date),
    (select t.regular_driver_id from public.trucks t where t.id = p_truck)
  );
$$;

comment on function public.planned_driver_for(uuid, date) is
  'Driver expected on a truck for one date: cover ?? run driver ?? regular driver. Null when nobody is rostered.';

revoke all on function public.planned_driver_for(uuid, date) from public;
grant execute on function public.planned_driver_for(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- True when the truck's planned driver is on approved leave for that date.
-- Null driver (roster not filled in) is deliberately NOT a block.
-- ---------------------------------------------------------------------------
create or replace function public.departure_driver_absent(p_truck uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.leave_requests l
    where l.user_id = public.planned_driver_for(p_truck, p_date)
      and l.status = 'approved'
      and l.start_date <= p_date
      and p_date <= l.end_date
  );
$$;

comment on function public.departure_driver_absent(uuid, date) is
  'True when the truck''s planned driver is on approved leave that date -- the departure gate (20260903000004).';

revoke all on function public.departure_driver_absent(uuid, date) from public;
grant execute on function public.departure_driver_absent(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- set_run_status.
-- Delta: refuse planned -> departed while the planned driver is on leave.
-- ---------------------------------------------------------------------------
create or replace function public.set_run_status(p_run uuid, p_status public.delivery_run_status)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_current public.delivery_run_status;
  v_truck uuid;
  v_date date;
begin
  select organization_id, status, truck_id, run_date
    into v_org, v_current, v_truck, v_date
  from public.delivery_runs where id = p_run;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'invalid_transition';
  end if;

  if not public.has_permission(v_org, 'dispatch', 'edit') then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if not (
    (v_current = 'planned' and p_status = 'departed')
    or (v_current = 'departed' and p_status = 'completed')
    or (v_current = 'planned' and p_status = 'completed')
    -- Idempotent re-fire: confirm_order can still attach a newly-confirmed
    -- order to an already-completed run's delivery_runs row (it upserts on
    -- (truck_id, run_date) with no run-status check), and that order can
    -- later reach 'ready' via complete_order_task. Without this case those
    -- orders are permanently stuck at 'ready' -- completed -> completed
    -- is allowed specifically so the ready -> delivered sweep below can
    -- run again and pick them up.
    or (v_current = 'completed' and p_status = 'completed')
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_transition';
  end if;

  if p_status = 'departed' then
    if public.departure_driver_absent(v_truck, v_date) then
      raise exception using errcode = 'P0001', message = 'driver_on_leave';
    end if;

    if exists (
      select 1 from public.orders
      where run_id = p_run and status = 'ready' and loaded_at is null
    ) then
      raise exception using errcode = 'P0001', message = 'not_loaded';
    end if;

    update public.orders
    set run_id = null, assignment_source = 'none', loaded_at = null, loaded_by = null
    where run_id = p_run and status <> 'ready';
  end if;

  update public.delivery_runs set status = p_status where id = p_run;

  if p_status = 'completed' then
    -- Release the failed stops first, so the sweep below cannot see them.
    -- "Failed" means the latest attempt on this run failed: a stop that was
    -- failed and then re-attempted successfully (next_action = retry_today)
    -- is already 'delivered' and never reaches either statement.
    update public.orders o
    set run_id = null, assignment_source = 'none', loaded_at = null, loaded_by = null
    where o.run_id = p_run
      and o.status = 'ready'
      and (
        select a.outcome
        from public.delivery_attempts a
        where a.run_id = p_run and a.order_id = o.id
        order by a.attempted_at desc, a.id desc
        limit 1
      ) = 'failed';

    update public.orders set status = 'delivered'
    where run_id = p_run and status = 'ready';
  end if;
end;
$$;

revoke all on function public.set_run_status(uuid, public.delivery_run_status) from public;
grant execute on function public.set_run_status(uuid, public.delivery_run_status) to authenticated;

-- ---------------------------------------------------------------------------
-- dispatch_depart_truck.
-- Delta: refuse to depart while the planned driver is on leave.
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_depart_truck(p_truck uuid, p_date date)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_run uuid;
  v_current public.delivery_run_status;
begin
  select id, organization_id, status into v_run, v_org, v_current
  from public.delivery_runs
  where truck_id = p_truck and run_date = p_date
  for update;

  if v_run is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.has_permission(v_org, 'dispatch', 'edit') then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_current <> 'planned' then
    raise exception using errcode = 'P0001', message = 'invalid_transition';
  end if;

  if public.departure_driver_absent(p_truck, p_date) then
    raise exception using errcode = 'P0001', message = 'driver_on_leave';
  end if;

  if exists (
    select 1 from public.orders
    where run_id = v_run and status = 'ready' and loaded_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'not_loaded';
  end if;

  update public.orders
  set run_id = null, assignment_source = 'none', loaded_at = null, loaded_by = null
  where run_id = v_run and status <> 'ready';

  update public.delivery_runs set status = 'departed' where id = v_run;
end;
$$;

revoke all on function public.dispatch_depart_truck(uuid, date) from public;
grant execute on function public.dispatch_depart_truck(uuid, date) to authenticated;

commit;
