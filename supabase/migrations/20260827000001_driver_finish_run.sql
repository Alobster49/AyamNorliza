-- 20260827000001_driver_finish_run.sql
-- The driver closes their own run.
--
-- Until now only the office could complete a run (set_run_status is gated on
-- owner/org_admin/seller), so a driver who was done for the day left the run
-- 'departed' and had to phone the yard. driver_finish_run gives the driver the
-- same end state through the guard the rest of the driver flow already uses,
-- can_record_stop(run, org) -- the assigned driver or the office.
--
-- One deliberate difference from set_run_status: there is NO
-- "ready -> delivered" sweep here. That sweep is the office's bulk "these all
-- went out" shortcut, taken by someone looking at the paperwork. A driver
-- closing the run from the truck is saying "I am done", not "everything I did
-- not touch was delivered" -- turning an unattempted stop into a delivered
-- order with no attempt row, no weights and no proof would invent a delivery.
-- So every order that did not actually end delivered (failed, or never
-- attempted) is released back to the unassigned pool, the same release shape
-- driver_start_run and dispatch_depart_truck use, and the office re-plans it.
--
-- Cancelled orders stay attached: they are nobody's to re-plan.

begin;

create or replace function public.driver_finish_run(p_run uuid)
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
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.can_record_stop(p_run, v_org) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_current <> 'departed' then
    raise exception using errcode = 'P0001', message = 'invalid_transition';
  end if;

  update public.orders
  set run_id = null, assignment_source = 'none', loaded_at = null, loaded_by = null
  where run_id = p_run
    and status not in ('delivered', 'closed', 'cancelled');

  update public.delivery_runs set status = 'completed' where id = p_run;
end;
$$;

revoke all on function public.driver_finish_run(uuid) from public;
grant execute on function public.driver_finish_run(uuid) to authenticated;

commit;
