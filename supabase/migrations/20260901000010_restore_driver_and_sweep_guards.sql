-- Restore two behaviours the dynamic-RBAC rewrite dropped.
--
-- `20260901000002_dynamic_rbac_enforcement.sql` re-created 27 RPCs to move
-- them onto `has_permission()`. Two of them were rebuilt from a body that
-- predated later fixes, so those fixes were silently reverted. Both
-- regressions are live on production. Neither was caught, because the pgTAP
-- suite has been red for other reasons and nobody could read a signal out of
-- it — the tests below did fail, and did say exactly this.
--
-- 1. can_record_stop: any driver could act on any other driver's run.
--
--    The guard reads "the assigned driver, or someone overseeing the deck":
--
--      exists (... delivery_runs where id = p_run and driver_id = auth.uid())
--      or has_permission(p_org, 'driver_deck', 'edit')
--
--    But `driver_deck:edit` is exactly what the seeded `driver` role holds
--    (DEFAULT_ROLE_GRANTS in src/lib/auth/rbac.ts), so the second branch is
--    true for every driver in the org, not just for office staff. Any driver
--    could record stop outcomes on, and close, a colleague's run.
--
--    The office-override branch moves to `delivery_runs:edit`, which is the
--    grant that actually means "manages delivery runs": held by owner,
--    org_admin, seller and supervisor, and by neither driver nor inventory.
--    The assigned-driver branch is untouched, so a driver keeps full control
--    of their own run.
--
-- 2. set_run_status: completing a run turned failed stops into delivered.
--
--    20260823000003 fixed this once already, and its reasoning still stands:
--    a stop the driver recorded as failed silently became delivered — no
--    goods, no cash, but an order marked complete. The RBAC rewrite restored
--    the naive sweep. The release step is put back ahead of the sweep, so a
--    stop whose latest attempt on this run failed comes off the run at
--    'ready' and can be dispatched again instead of being marked delivered.
--
-- Both are re-covered by supabase/tests/rls/15_driver_write_path.sql,
-- 19_run_complete_failed_stops.sql and 25_driver_finish_run.sql, which fail
-- against the regressed definitions and pass against these.

begin;

-- ---------------------------------------------------------------------------
-- 1. Office override follows delivery_runs, not driver_deck.
-- ---------------------------------------------------------------------------
create or replace function public.can_record_stop(p_run uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    exists (select 1 from public.delivery_runs where id = p_run and driver_id = (select auth.uid()))
    or public.has_permission(p_org, 'delivery_runs', 'edit');
$$;

comment on function public.can_record_stop(uuid, uuid) is
  'True for the run''s assigned driver, or for staff who manage delivery runs. Deliberately NOT driver_deck:edit — every driver holds that, which would let any driver act on any run.';

-- ---------------------------------------------------------------------------
-- 2. Completing a run must not turn a failed stop into a delivered one.
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
begin
  select organization_id, status into v_org, v_current from public.delivery_runs where id = p_run;

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

commit;
