-- 20260823000010_anon_zone_slot_lookup.sql
-- Terus Segar wall-free checkout -- anonymous buyers must check zone
-- coverage and slot availability before an account exists; delivery
-- options are storefront data (any free buyer signup could read them), so
-- the buyer/member guard is dropped from get_delivery_options and both
-- read-only lookups (get_delivery_options, resolve_zone_for_postcode) are
-- granted to anon. Writes (place_order etc.) remain authenticated-only.

begin;

-- ---------------------------------------------------------------------------
-- get_delivery_options: zone -> valid (date, slot, truck) options for the
-- next 14 days starting tomorrow, minus blocked dates, minus full slots.
--
-- Storefront read as of 2026-08-23: the buyer/member guard that used to
-- reject callers who were neither an active buyer nor an active member of
-- p_org is dropped. The Terus Segar checkout renders for anonymous buyers
-- (the account is created inline at submit), so slot availability must be
-- readable pre-auth -- the same data any freely-created buyer account could
-- already see, so the guard provided only trivial protection. Still
-- plpgsql (not sql) and stable, matching the original definition; the
-- query logic below is otherwise byte-identical to 20260810000002.
-- ---------------------------------------------------------------------------
create or replace function public.get_delivery_options(p_org uuid, p_zone uuid)
returns table (
  option_date date,
  slot_id uuid,
  truck_id uuid,
  truck_name text,
  start_time time,
  end_time time,
  remaining integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- Columns are qualified with the `options` alias because plpgsql (unlike
  -- plain sql-language functions) binds unqualified names in this query
  -- against the RETURNS TABLE out-parameters first, which are identically
  -- named to these column aliases and would otherwise raise "column
  -- reference is ambiguous".
  return query
  select options.option_date, options.slot_id, options.truck_id, options.truck_name,
    options.start_time, options.end_time, options.remaining
  from (
    select
      d::date as option_date,
      s.id as slot_id,
      t.id as truck_id,
      t.name as truck_name,
      s.start_time,
      s.end_time,
      case when s.max_orders is null then null
        else s.max_orders - (
          select count(*)::integer from public.orders o
          where o.slot_id = s.id and o.delivery_date = d::date and o.status <> 'cancelled'
        )
      end as remaining
    from generate_series(current_date + 1, current_date + 14, interval '1 day') as d
    join public.truck_zones tz on tz.zone_id = p_zone
    join public.trucks t on t.id = tz.truck_id and t.is_active = true and t.organization_id = p_org
    join public.delivery_slots s on s.truck_id = t.id and s.is_active = true
      and s.weekday = extract(dow from d)::smallint
    where not exists (
      select 1 from public.schedule_blocks b
      where b.organization_id = p_org
        and b.block_date = d::date
        and (b.truck_id is null or b.truck_id = t.id)
    )
  ) options
  where options.remaining is null or options.remaining > 0
  order by options.option_date, options.start_time;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: both read-only lookups become storefront data. resolve_zone_for_
-- postcode (20260822000002) was already verified clean of auth reads --
-- it only filters by p_org and postcode range -- so it needs no rewrite,
-- just the anon grant. Writes (place_order, confirm_order, etc.) stay
-- authenticated-only and are untouched by this migration.
-- ---------------------------------------------------------------------------
grant execute on function public.resolve_zone_for_postcode(uuid, text) to anon;
grant execute on function public.get_delivery_options(uuid, uuid) to anon;

commit;
