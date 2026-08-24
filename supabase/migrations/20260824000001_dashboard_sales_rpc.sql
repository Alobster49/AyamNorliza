-- 20260824000001_dashboard_sales_rpc.sql
-- Owner/admin dashboard: sales aggregates for a date range.
-- Revenue basis: delivered/closed orders by delivery_date (spec
-- docs/superpowers/specs/2026-08-24-owner-dashboard-design.md).

begin;

create or replace function public.get_dashboard_sales(
  p_organization_id uuid,
  p_from date,
  p_to date,
  p_bucket text default 'day'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
  v_len integer := (p_to - p_from) + 1;
  v_prev_from date;
  v_prev_to date := p_from - 1;
  v_kpis jsonb;
  v_prev jsonb;
  v_series jsonb;
  v_funnel jsonb;
  v_products jsonb;
  v_customers jsonb;
  v_zones jsonb;
begin
  if not public.has_org_role(p_organization_id, array['owner','org_admin','seller']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if p_to < p_from or v_len > 400 then
    raise exception using errcode = 'P0001', message = 'invalid range';
  end if;
  if p_bucket not in ('day','week') then
    raise exception using errcode = 'P0001', message = 'invalid bucket';
  end if;

  v_prev_from := p_from - v_len;

  select coalesce(o.default_time_zone, 'Asia/Kuala_Lumpur') into v_tz
  from public.organizations o where o.id = p_organization_id;

  select jsonb_build_object(
    'revenue', coalesce(sum(o.total_amount), 0),
    'orders', count(*),
    'kg', coalesce((
      select sum(oi.final_weight_kg)
      from public.order_items oi
      join public.orders o2 on o2.id = oi.order_id
      where o2.organization_id = p_organization_id
        and o2.status in ('delivered','closed')
        and o2.delivery_date between p_from and p_to
        and not oi.is_cancelled
    ), 0))
  into v_kpis
  from public.orders o
  where o.organization_id = p_organization_id
    and o.status in ('delivered','closed')
    and o.delivery_date between p_from and p_to;

  select jsonb_build_object(
    'revenue', coalesce(sum(o.total_amount), 0),
    'orders', count(*),
    'kg', coalesce((
      select sum(oi.final_weight_kg)
      from public.order_items oi
      join public.orders o2 on o2.id = oi.order_id
      where o2.organization_id = p_organization_id
        and o2.status in ('delivered','closed')
        and o2.delivery_date between v_prev_from and v_prev_to
        and not oi.is_cancelled
    ), 0))
  into v_prev
  from public.orders o
  where o.organization_id = p_organization_id
    and o.status in ('delivered','closed')
    and o.delivery_date between v_prev_from and v_prev_to;

  select coalesce(jsonb_agg(
           jsonb_build_object('bucket', s.b, 'revenue', s.r, 'orders', s.n)
           order by s.b), '[]'::jsonb)
  into v_series
  from (
    select case when p_bucket = 'week'
                then date_trunc('week', o.delivery_date::timestamp)::date
                else o.delivery_date end as b,
           sum(o.total_amount) as r,
           count(*) as n
    from public.orders o
    where o.organization_id = p_organization_id
      and o.status in ('delivered','closed')
      and o.delivery_date between p_from and p_to
    group by 1
  ) s;

  select coalesce(jsonb_object_agg(f.status, f.n), '{}'::jsonb)
  into v_funnel
  from (
    select o.status::text as status, count(*) as n
    from public.orders o
    where o.organization_id = p_organization_id
      and ((o.created_at at time zone v_tz)::date) between p_from and p_to
    group by o.status
  ) f;

  select coalesce(jsonb_agg(
           jsonb_build_object('name', t.name, 'revenue', t.revenue, 'kg', t.kg)
           order by t.revenue desc), '[]'::jsonb)
  into v_products
  from (
    select p.name,
           sum(coalesce(oi.line_total, 0)) as revenue,
           sum(coalesce(oi.final_weight_kg, 0)) as kg
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.products p on p.id = oi.product_id
    where o.organization_id = p_organization_id
      and o.status in ('delivered','closed')
      and o.delivery_date between p_from and p_to
      and not oi.is_cancelled
    group by p.name
    order by revenue desc
    limit 5
  ) t;

  select coalesce(jsonb_agg(
           jsonb_build_object('name', t.name, 'revenue', t.revenue, 'orders', t.n)
           order by t.revenue desc), '[]'::jsonb)
  into v_customers
  from (
    select c.name, sum(o.total_amount) as revenue, count(*) as n
    from public.orders o
    join public.customers c on c.id = o.customer_id
    where o.organization_id = p_organization_id
      and o.status in ('delivered','closed')
      and o.delivery_date between p_from and p_to
    group by c.name
    order by revenue desc
    limit 5
  ) t;

  select coalesce(jsonb_agg(
           jsonb_build_object('name', t.name, 'revenue', t.revenue, 'orders', t.n)
           order by t.revenue desc), '[]'::jsonb)
  into v_zones
  from (
    select z.name, sum(o.total_amount) as revenue, count(*) as n
    from public.orders o
    join public.delivery_zones z on z.id = o.zone_id
    where o.organization_id = p_organization_id
      and o.status in ('delivered','closed')
      and o.delivery_date between p_from and p_to
    group by z.name
    order by revenue desc
    limit 5
  ) t;

  return jsonb_build_object(
    'kpis', v_kpis,
    'previous', v_prev,
    'series', v_series,
    'funnel', v_funnel,
    'topProducts', v_products,
    'topCustomers', v_customers,
    'topZones', v_zones
  );
end;
$$;

revoke all on function public.get_dashboard_sales(uuid, date, date, text) from public;
grant execute on function public.get_dashboard_sales(uuid, date, date, text) to authenticated;

commit;
