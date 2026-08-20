-- Dispatch redesign: loading confirmation + optional kg capacity.
-- loaded_at/loaded_by mark an order physically confirmed onto its truck by
-- a loader; capacity_kg lets the plan deck show weight-based utilization.

alter table public.orders
  add column if not exists loaded_at timestamptz,
  add column if not exists loaded_by uuid references auth.users (id) on delete set null;

alter table public.trucks
  add column if not exists capacity_kg numeric(7, 2)
    constraint trucks_capacity_kg_positive check (capacity_kg is null or capacity_kg > 0);

-- ---------------------------------------------------------------------------
-- dispatch_set_loaded: loader confirms (or un-confirms) an order onto its
-- assigned truck. Mirrors dispatch_assign_order's guard style.
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

  update public.orders
  set loaded_at = case when p_loaded then now() else null end,
      loaded_by = case when p_loaded then auth.uid() else null end
  where id = p_order;
end;
$$;

revoke all on function public.dispatch_set_loaded(uuid, boolean) from public;
grant execute on function public.dispatch_set_loaded(uuid, boolean) to authenticated;
