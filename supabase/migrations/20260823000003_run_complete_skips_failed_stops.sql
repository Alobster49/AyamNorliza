-- 20260823000003_run_complete_skips_failed_stops.sql
-- Completing a run must not turn a failed stop into a delivered one.
--
-- driver_fail_stop deliberately leaves the order at 'ready' -- the customer
-- is still owed the goods, and delivery_next_action says what happens next.
-- But the completion sweep in set_run_status was
--
--   update public.orders set status = 'delivered'
--   where run_id = p_run and status = 'ready';
--
-- so the moment the office closed the run, every stop the driver had just
-- recorded as failed silently became delivered: no goods, no cash, but an
-- order the pipeline treats as fulfilled and ready to close.
--
-- Fix: before the sweep, release the orders whose most recent attempt *on
-- this run* failed. They keep status 'ready' and come off the run -- the
-- same release shape dispatch_depart_truck already uses -- so they show up
-- in the unassigned pool for tomorrow instead of being swept. Orders with
-- no attempt at all are still swept: closing a run remains the office's
-- bulk "these all went out" shortcut.
--
-- Also takes the run row `for update`, matching dispatch_depart_truck and
-- dispatch_reorder_run. set_run_status was the only run RPC reading the
-- status it gates on without locking it, so two concurrent transitions
-- could both pass the check against the same pre-state.

begin;

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
  select organization_id, status into v_org, v_current
  from public.delivery_runs where id = p_run for update;

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
