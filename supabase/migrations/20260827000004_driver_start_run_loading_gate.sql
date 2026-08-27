-- Driver start-run loading gate.
--
-- The runs board blocks "Mark departed" while orders on the run are unloaded,
-- but that rule lived only in the office UI (departureCheck) -- the driver
-- deck's "Start delivering" walked straight past it. And the strip below only
-- releases orders with status <> 'ready', so a weighed-but-never-loaded order
-- stayed on the run and the driver was sent to deliver goods that were never
-- put on the truck.
--
-- driver_start_run now refuses to depart ('not_loaded') unless every
-- non-cancelled order on the run is 'ready' AND signed off by the loading
-- screen. Cancelled orders are excluded from the gate -- dispatch_set_loaded
-- only accepts confirmed/ready orders, so a stop cancelled after assignment
-- could never satisfy it and would block the run forever -- and the existing
-- strip still releases them on the way out. The office keeps its own escape
-- hatch: the dispatch board's depart flow drops not-ready orders behind a
-- confirm dialog that names them.

begin;

create or replace function public.driver_start_run(p_run uuid)
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

  if v_current <> 'planned' then
    raise exception using errcode = 'P0001', message = 'invalid_transition';
  end if;

  if exists (
    select 1 from public.orders
    where run_id = p_run
      and status <> 'cancelled'
      and (status <> 'ready' or loaded_at is null)
  ) then
    raise exception using errcode = 'P0001', message = 'not_loaded';
  end if;

  -- Only cancelled orders can reach this strip now; kept in the
  -- dispatch_depart_truck release shape so they leave the run cleanly.
  update public.orders
  set run_id = null, assignment_source = 'none', loaded_at = null, loaded_by = null
  where run_id = p_run and status <> 'ready';

  update public.delivery_runs set status = 'departed' where id = p_run;
end;
$$;

revoke all on function public.driver_start_run(uuid) from public;
grant execute on function public.driver_start_run(uuid) to authenticated;

commit;
