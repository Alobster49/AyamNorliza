-- 20260827000006_dashboard_insights_weight_loss.sql
-- Owner/admin dashboard: value weight leakage in RM (losses only) and list
-- the top orders the loss came from. Replaces get_dashboard_insights from
-- 20260824000003; only the weight block changes.

begin;

create or replace function public.get_dashboard_insights(
  p_organization_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
  v_today date;
  v_pricing jsonb;
  v_weight jsonb;
  v_retention jsonb;
  v_delivery jsonb;
begin
  if not public.has_org_role(p_organization_id, array['owner','org_admin','seller']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if p_to < p_from or (p_to - p_from) + 1 > 400 then
    raise exception using errcode = 'P0001', message = 'invalid range';
  end if;

  select coalesce(o.default_time_zone, 'Asia/Kuala_Lumpur') into v_tz
  from public.organizations o where o.id = p_organization_id;
  v_today := (now() at time zone v_tz)::date;

  -- Realized RM/kg per product (delivered/closed, non-cancelled items).
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', t.name, 'kg', t.kg, 'revenue', t.revenue,
           'realizedPerKg', case when t.kg > 0 then round(t.revenue / t.kg, 2) else null end
         ) order by t.revenue desc), '[]'::jsonb)
  into v_pricing
  from (
    select p.name,
           sum(coalesce(oi.final_weight_kg, 0)) as kg,
           sum(coalesce(oi.line_total, 0)) as revenue
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.products p on p.id = oi.product_id
    where o.organization_id = p_organization_id
      and o.status in ('delivered','closed')
      and o.delivery_date between p_from and p_to
      and not oi.is_cancelled
    group by p.name
    order by revenue desc
    limit 10
  ) t;

  -- Weight leakage: warehouse allocation vs final weighed, where both exist.
  -- lost* figures are loss-only (per item, gains ignored); RM valuation
  -- requires price_per_kg and rounds per item before summing.
  select jsonb_build_object(
    'warehouseKg', coalesce(sum(w.warehouse_kg), 0),
    'finalKg', coalesce(sum(w.final_kg), 0),
    'diffKg', coalesce(sum(w.warehouse_kg - w.final_kg), 0),
    'lostKg', coalesce(sum(w.lost_kg), 0),
    'lostRm', coalesce(sum(w.lost_rm), 0),
    'byProduct', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', w2.name, 'warehouseKg', w2.warehouse_kg, 'finalKg', w2.final_kg,
        'diffKg', w2.warehouse_kg - w2.final_kg,
        'lostKg', w2.lost_kg, 'lostRm', w2.lost_rm)
        order by w2.lost_rm desc, w2.lost_kg desc)
      from (
        select p.name,
               sum(oi.warehouse_weight_kg) as warehouse_kg,
               sum(oi.final_weight_kg) as final_kg,
               sum(greatest(oi.warehouse_weight_kg - oi.final_weight_kg, 0)) as lost_kg,
               sum(case when oi.price_per_kg is not null
                     then round(greatest(oi.warehouse_weight_kg - oi.final_weight_kg, 0) * oi.price_per_kg, 2)
                     else 0 end) as lost_rm
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        join public.products p on p.id = oi.product_id
        where o.organization_id = p_organization_id
          and o.status in ('delivered','closed')
          and o.delivery_date between p_from and p_to
          and not oi.is_cancelled
          and oi.warehouse_weight_kg is not null
          and oi.final_weight_kg is not null
        group by p.name
        order by lost_rm desc, lost_kg desc
        limit 5
      ) w2), '[]'::jsonb),
    'byOrder', coalesce((
      select jsonb_agg(jsonb_build_object(
        'orderId', w3.order_id, 'customerName', w3.customer_name,
        'deliveryDate', w3.delivery_date,
        'lostKg', w3.lost_kg, 'lostRm', w3.lost_rm)
        order by w3.lost_rm desc, w3.lost_kg desc)
      from (
        select o.id as order_id, c.name as customer_name, o.delivery_date,
               sum(greatest(oi.warehouse_weight_kg - oi.final_weight_kg, 0)) as lost_kg,
               sum(case when oi.price_per_kg is not null
                     then round(greatest(oi.warehouse_weight_kg - oi.final_weight_kg, 0) * oi.price_per_kg, 2)
                     else 0 end) as lost_rm
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        join public.customers c on c.id = o.customer_id
        where o.organization_id = p_organization_id
          and o.status in ('delivered','closed')
          and o.delivery_date between p_from and p_to
          and not oi.is_cancelled
          and oi.warehouse_weight_kg is not null
          and oi.final_weight_kg is not null
        group by o.id, c.name, o.delivery_date
        having sum(case when oi.price_per_kg is not null
                     then round(greatest(oi.warehouse_weight_kg - oi.final_weight_kg, 0) * oi.price_per_kg, 2)
                     else 0 end) > 0
        order by lost_rm desc, lost_kg desc
        limit 10
      ) w3), '[]'::jsonb))
  into v_weight
  from (
    select sum(oi.warehouse_weight_kg) as warehouse_kg,
           sum(oi.final_weight_kg) as final_kg,
           sum(greatest(oi.warehouse_weight_kg - oi.final_weight_kg, 0)) as lost_kg,
           sum(case when oi.price_per_kg is not null
                 then round(greatest(oi.warehouse_weight_kg - oi.final_weight_kg, 0) * oi.price_per_kg, 2)
                 else 0 end) as lost_rm
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.organization_id = p_organization_id
      and o.status in ('delivered','closed')
      and o.delivery_date between p_from and p_to
      and not oi.is_cancelled
      and oi.warehouse_weight_kg is not null
      and oi.final_weight_kg is not null
  ) w;

  -- Retention: customers active in range, split new vs returning; silent =
  -- customers whose last delivered/closed order is 30+ days before today.
  select jsonb_build_object(
    'active', (
      select count(distinct o.customer_id) from public.orders o
      where o.organization_id = p_organization_id
        and o.status in ('delivered','closed')
        and o.delivery_date between p_from and p_to),
    'newCustomers', (
      select count(*) from (
        select o.customer_id, min(o.delivery_date) as first_date
        from public.orders o
        where o.organization_id = p_organization_id
          and o.status in ('delivered','closed')
        group by o.customer_id
      ) fc where fc.first_date between p_from and p_to),
    'returning', (
      select count(distinct o.customer_id) from public.orders o
      where o.organization_id = p_organization_id
        and o.status in ('delivered','closed')
        and o.delivery_date between p_from and p_to
        and exists (
          select 1 from public.orders prior
          where prior.organization_id = p_organization_id
            and prior.customer_id = o.customer_id
            and prior.status in ('delivered','closed')
            and prior.delivery_date < p_from)),
    'silent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', s.name, 'lastOrderDate', s.last_date, 'lifetimeRevenue', s.revenue)
        order by s.revenue desc)
      from (
        select c.name, max(o.delivery_date) as last_date, sum(o.total_amount) as revenue
        from public.orders o
        join public.customers c on c.id = o.customer_id
        where o.organization_id = p_organization_id
          and o.status in ('delivered','closed')
        group by c.id, c.name
        having max(o.delivery_date) < v_today - 30
        order by sum(o.total_amount) desc
        limit 10
      ) s), '[]'::jsonb))
  into v_retention;

  -- Delivery quality: attempts in range by org-timezone day, plus slot fill.
  select jsonb_build_object(
    'attempts', count(*),
    'failed', count(*) filter (where da.outcome = 'failed'),
    'byZone', coalesce((
      select jsonb_agg(jsonb_build_object('zone', z.name, 'total', z.total, 'failed', z.failed)
               order by z.failed desc)
      from (
        select dz.name, count(*) as total,
               count(*) filter (where da2.outcome = 'failed') as failed
        from public.delivery_attempts da2
        join public.orders o2 on o2.id = da2.order_id
        join public.delivery_zones dz on dz.id = o2.zone_id
        where da2.organization_id = p_organization_id
          and ((da2.attempted_at at time zone v_tz)::date) between p_from and p_to
        group by dz.name
      ) z), '[]'::jsonb),
    'slotOrders', (
      select count(*) from public.orders o
      where o.organization_id = p_organization_id
        and o.status <> 'cancelled'
        and o.delivery_date between p_from and p_to),
    'slotCapacity', coalesce((
      select sum(ds.max_orders)
      from public.delivery_slots ds
      join generate_series(p_from, p_to, interval '1 day') d
        on extract(dow from d)::smallint = ds.weekday
      where ds.organization_id = p_organization_id
        and ds.is_active
        and ds.max_orders is not null), 0))
  into v_delivery
  from public.delivery_attempts da
  where da.organization_id = p_organization_id
    and ((da.attempted_at at time zone v_tz)::date) between p_from and p_to;

  return jsonb_build_object(
    'pricing', v_pricing,
    'weight', v_weight,
    'retention', v_retention,
    'delivery', v_delivery
  );
end;
$$;

revoke all on function public.get_dashboard_insights(uuid, date, date) from public;
grant execute on function public.get_dashboard_insights(uuid, date, date) to authenticated;

commit;
