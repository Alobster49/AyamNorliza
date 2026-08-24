-- 20260824000002_dashboard_today_rpc.sql
-- Owner/admin dashboard: today's operations snapshot (org-timezone day).

begin;

create or replace function public.get_dashboard_today(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
  v_today date;
  v_runs jsonb;
  v_tasks_pending integer;
  v_tasks_done_today integer;
  v_orders_without_run integer;
  v_market_date date;
begin
  if not public.has_org_role(p_organization_id, array['owner','org_admin','seller']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  select coalesce(o.default_time_zone, 'Asia/Kuala_Lumpur') into v_tz
  from public.organizations o where o.id = p_organization_id;

  v_today := (now() at time zone v_tz)::date;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'truckName', t.name,
           'truckCode', t.code,
           'status', r.status,
           'ordersTotal', (select count(*) from public.orders o where o.run_id = r.id),
           'delivered', (select count(*) from public.orders o
                         where o.run_id = r.id and o.status in ('delivered','closed')),
           'failed', (select count(*) from public.orders o
                      where o.run_id = r.id and (
                        select da.outcome::text from public.delivery_attempts da
                        where da.order_id = o.id and da.run_id = r.id
                        order by da.attempted_at desc limit 1) = 'failed')
         ) order by t.code), '[]'::jsonb)
  into v_runs
  from public.delivery_runs r
  join public.trucks t on t.id = r.truck_id
  where r.organization_id = p_organization_id
    and r.run_date = v_today;

  select count(*) into v_tasks_pending
  from public.order_tasks ot
  where ot.organization_id = p_organization_id and ot.status = 'pending';

  select count(*) into v_tasks_done_today
  from public.order_tasks ot
  where ot.organization_id = p_organization_id
    and ot.status = 'done'
    and ot.done_at is not null
    and ((ot.done_at at time zone v_tz)::date) = v_today;

  select count(*) into v_orders_without_run
  from public.orders o
  where o.organization_id = p_organization_id
    and o.status in ('confirmed','ready')
    and o.run_id is null
    and o.delivery_date = v_today;

  select max(mp.price_date) into v_market_date from public.market_prices mp;

  return jsonb_build_object(
    'date', v_today,
    'runs', v_runs,
    'tasksPending', v_tasks_pending,
    'tasksDoneToday', v_tasks_done_today,
    'ordersWithoutRun', v_orders_without_run,
    'marketPriceDate', v_market_date,
    'marketStale', (v_market_date is null or v_market_date < v_today - 3)
  );
end;
$$;

revoke all on function public.get_dashboard_today(uuid) from public;
grant execute on function public.get_dashboard_today(uuid) to authenticated;

commit;
