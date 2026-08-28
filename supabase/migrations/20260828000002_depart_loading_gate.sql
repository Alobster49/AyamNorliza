-- Close the office-side loading gate gap.
--
-- 20260827000004 hard-gated driver_start_run on every non-cancelled order
-- being 'ready' AND loaded_at signed off, but the two office-side departure
-- paths never got the same check:
--   * dispatch_depart_truck (20260814000001, refreshed by 20260820000002)
--   * set_run_status('departed') (20260820000002)
-- Both already drop not-ready orders back to the pool on depart (the
-- dispatch board's own escape hatch, confirmed via the "leave behind" dialog
-- naming them) -- that behaviour is unchanged. What they missed is a 'ready'
-- order that was never physically signed off by the loading screen
-- (loaded_at is null): that order stayed on the run and departed with the
-- truck instead of being caught.
--
-- Both functions below now refuse to depart ('not_loaded') while any
-- 'ready' order on the run has loaded_at is null, using the exact error
-- code/message shape driver_start_run raises so the existing client mapping
-- (errors.drive.run.notLoaded) picks it up without changes. Everything else
-- is copied wholesale from 20260820000002 so grants/security stay intact.

begin;

-- ---------------------------------------------------------------------------
-- set_run_status.
-- Delta: refuse planned -> departed while a 'ready' order is unloaded.
-- ---------------------------------------------------------------------------
create or replace function public.set_run_status(p_run uuid, p_status public.delivery_run_status)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_current public.delivery_run_status;
begin
  select organization_id, status into v_org, v_current from public.delivery_runs where id = p_run;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'invalid_transition';
  end if;

  if not public.has_org_role(v_org, array['owner', 'org_admin', 'seller']) then
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
    update public.orders set status = 'delivered' where run_id = p_run and status = 'ready';
  end if;
end;
$$;

revoke all on function public.set_run_status(uuid, public.delivery_run_status) from public;
grant execute on function public.set_run_status(uuid, public.delivery_run_status) to authenticated;

-- ---------------------------------------------------------------------------
-- dispatch_depart_truck.
-- Delta: refuse to depart while a 'ready' order is unloaded.
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

  if not public.has_org_role(v_org, array['owner', 'org_admin', 'seller', 'logistics']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_current <> 'planned' then
    raise exception using errcode = 'P0001', message = 'invalid_transition';
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
