-- Dispatch redesign: keep loaded_at/loaded_by honest across every move.
--
-- 20260820000001 added the load confirmation but nothing clears it when the
-- order leaves the truck it was loaded onto. A ticket unassigned back to the
-- pool, released on depart, or dragged to a different truck would keep a
-- stale "loaded" mark and show as physically on board a truck it is not on.
-- Every path that moves an order off its truck now clears the mark; a
-- same-truck re-assign keeps it (the load is still valid).
--
-- dispatch_set_loaded also grows a not_assigned guard: confirming a load on
-- an order with no run is meaningless (there is no truck to be loaded onto).
--
-- Each function below is the 20260814000001 / 20260820000001 body plus those
-- deltas only.

-- ---------------------------------------------------------------------------
-- dispatch_assign_order: assign a confirmed/ready order to a truck.
-- Delta: clears the load mark when the order changes trucks.
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_assign_order(p_order uuid, p_truck uuid, p_source public.assignment_source)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_status public.order_status;
  v_date date;
  v_old_run uuid;
  v_old_run_status public.delivery_run_status;
  v_old_truck uuid;
  v_source public.assignment_source;
  v_run uuid;
begin
  if p_source not in ('auto', 'manual') then
    raise exception using errcode = 'P0001', message = 'invalid_source';
  end if;

  select organization_id, status, delivery_date, run_id, truck_id, assignment_source
  into v_org, v_status, v_date, v_old_run, v_old_truck, v_source
  from public.orders where id = p_order for update;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.has_org_role(v_org, array['owner', 'org_admin', 'seller', 'logistics']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_status not in ('confirmed', 'ready') then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  -- Auto never overrides manual.
  if p_source = 'auto' and v_source = 'manual' then
    return;
  end if;

  if v_old_run is not null then
    select status into v_old_run_status from public.delivery_runs where id = v_old_run;
    if v_old_run_status = 'departed' then
      raise exception using errcode = 'P0001', message = 'run_departed';
    end if;
  end if;

  if not exists (
    select 1 from public.trucks
    where id = p_truck and organization_id = v_org and is_active = true
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_truck';
  end if;

  insert into public.delivery_runs (organization_id, truck_id, run_date)
  values (v_org, p_truck, v_date)
  on conflict (truck_id, run_date) do update set truck_id = excluded.truck_id
  returning id into v_run;

  if (select status from public.delivery_runs where id = v_run) = 'departed' then
    raise exception using errcode = 'P0001', message = 'run_departed';
  end if;

  -- Moving to a different truck invalidates the load confirmation; a
  -- same-truck re-assign (pool -> back on its own truck) keeps it.
  update public.orders
  set truck_id = p_truck,
      run_id = v_run,
      assignment_source = p_source,
      loaded_at = case when p_truck is distinct from v_old_truck then null else loaded_at end,
      loaded_by = case when p_truck is distinct from v_old_truck then null else loaded_by end
  where id = p_order;
end;
$$;

revoke all on function public.dispatch_assign_order(uuid, uuid, public.assignment_source) from public;
grant execute on function public.dispatch_assign_order(uuid, uuid, public.assignment_source) to authenticated;

-- ---------------------------------------------------------------------------
-- dispatch_unassign_order: send a ticket back to the pool.
-- Delta: an order in the pool is on no truck, so the load mark is cleared.
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_unassign_order(p_order uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_status public.order_status;
  v_run uuid;
  v_run_status public.delivery_run_status;
begin
  select organization_id, status, run_id into v_org, v_status, v_run
  from public.orders where id = p_order for update;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.has_org_role(v_org, array['owner', 'org_admin', 'seller', 'logistics']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_status not in ('confirmed', 'ready') then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  if v_run is not null then
    select status into v_run_status from public.delivery_runs where id = v_run;
    if v_run_status = 'departed' then
      raise exception using errcode = 'P0001', message = 'run_departed';
    end if;
  end if;

  -- Clear run_id too, not just assignment_source: leaving the old run_id
  -- behind blocks reassignment (dispatch_assign_order upserts the same
  -- truck+date row) and lets set_run_status's completion sweep
  -- (status='ready' and run_id = p_run) phantom-deliver a ticket that left
  -- the run.
  update public.orders
  set assignment_source = 'none', run_id = null, loaded_at = null, loaded_by = null
  where id = p_order;
end;
$$;

revoke all on function public.dispatch_unassign_order(uuid) from public;
grant execute on function public.dispatch_unassign_order(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- set_run_status.
-- Delta: the release-on-depart sweep clears the load mark too.
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
-- Delta: the release-on-depart sweep clears the load mark too.
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

  update public.orders
  set run_id = null, assignment_source = 'none', loaded_at = null, loaded_by = null
  where run_id = v_run and status <> 'ready';

  update public.delivery_runs set status = 'departed' where id = v_run;
end;
$$;

revoke all on function public.dispatch_depart_truck(uuid, date) from public;
grant execute on function public.dispatch_depart_truck(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- dispatch_set_loaded.
-- Delta: not_assigned guard -- an order with no run is on no truck, so
-- there is nothing to confirm a load against.
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_set_loaded(p_order uuid, p_loaded boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_status public.order_status;
  v_run uuid;
  v_run_status public.delivery_run_status;
begin
  select organization_id, status, run_id
  into v_org, v_status, v_run
  from public.orders where id = p_order for update;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.has_org_role(v_org, array['owner', 'org_admin', 'seller', 'logistics']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_status not in ('confirmed', 'ready') then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  if v_run is not null then
    select status into v_run_status from public.delivery_runs where id = v_run;
    if v_run_status = 'departed' then
      raise exception using errcode = 'P0001', message = 'run_departed';
    end if;
  end if;

  if p_loaded and v_run is null then
    raise exception using errcode = 'P0001', message = 'not_assigned';
  end if;

  update public.orders
  set loaded_at = case when p_loaded then now() else null end,
      loaded_by = case when p_loaded then auth.uid() else null end
  where id = p_order;
end;
$$;

revoke all on function public.dispatch_set_loaded(uuid, boolean) from public;
grant execute on function public.dispatch_set_loaded(uuid, boolean) to authenticated;
