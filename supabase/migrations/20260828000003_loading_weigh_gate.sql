-- Loading weigh gate.
--
-- The loading screen could sign an order onto the truck before the warehouse
-- ever weighed it: dispatch_set_loaded accepted any 'confirmed' order, and
-- 'confirmed' is exactly the status of an order whose weigh task is still
-- open (complete_order_task is the only path to 'ready', and it refuses to
-- finish until every non-cancelled line has a recorded weight). So a loader
-- could tap "load" on a bird nobody had put on the scale.
--
-- dispatch_set_loaded now refuses p_loaded = true unless the order is
-- 'ready' ('not_weighed'). Un-loading (p_loaded = false) keeps accepting
-- both statuses so an already-loaded order that somehow slid back to
-- 'confirmed' can still be taken off the truck. Everything else is copied
-- wholesale from 20260820000002 so grants/security stay intact.

begin;

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

  -- 'ready' is set only by complete_order_task, after every non-cancelled
  -- line has a recorded weight -- so this is the "fully weighed" gate.
  if p_loaded and v_status <> 'ready' then
    raise exception using errcode = 'P0001', message = 'not_weighed';
  end if;

  update public.orders
  set loaded_at = case when p_loaded then now() else null end,
      loaded_by = case when p_loaded then auth.uid() else null end
  where id = p_order;
end;
$$;

revoke all on function public.dispatch_set_loaded(uuid, boolean) from public;
grant execute on function public.dispatch_set_loaded(uuid, boolean) to authenticated;

commit;
