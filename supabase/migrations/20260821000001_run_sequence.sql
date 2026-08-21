-- 20260821000001_run_sequence.sql
-- Delivery runs redesign, phase 2: give every order a position in its run.
--
-- Until now the runs screen showed stops in whatever order the query returned,
-- so the driver invented a route and nobody in the office knew what it was.
-- orders.run_sequence is the route order the dispatcher sets; the runs screen,
-- the manifest and (later) the driver deck all read the same number.
--
-- Sequences are per-run and 1-based. They are kept dense by
-- dispatch_reorder_run, which rewrites the whole run in one statement, and by
-- a trigger that appends newly-assigned orders to the end.

begin;

-- ---------------------------------------------------------------------------
-- Column
-- ---------------------------------------------------------------------------
alter table public.orders add column if not exists run_sequence integer null;

comment on column public.orders.run_sequence is
  'Position of this order in its delivery run, 1-based and dense. Null when the order is not on a run.';

create index if not exists orders_run_sequence_idx on public.orders(run_id, run_sequence)
  where run_id is not null;

-- ---------------------------------------------------------------------------
-- Backfill: the order the screen was already showing (slot window, then zone,
-- then customer name) becomes the starting route order, so nothing jumps
-- around the first time someone opens the page after this ships.
-- ---------------------------------------------------------------------------
with ranked as (
  select
    o.id,
    row_number() over (
      partition by o.run_id
      order by s.start_time nulls last, z.name nulls last, c.name nulls last, o.id
    ) as seq
  from public.orders o
  left join public.delivery_slots s on s.id = o.slot_id
  left join public.delivery_zones z on z.id = o.zone_id
  left join public.customers c on c.id = o.customer_id
  where o.run_id is not null
)
update public.orders o
set run_sequence = ranked.seq
from ranked
where ranked.id = o.id and o.run_sequence is null;

-- ---------------------------------------------------------------------------
-- Trigger: an order joining a run lands at the end of it; an order leaving a
-- run loses its position. Fires only when run_id is written, so
-- dispatch_reorder_run (which touches run_sequence alone) is not disturbed.
-- ---------------------------------------------------------------------------
create or replace function public.orders_set_run_sequence()
returns trigger
language plpgsql
as $$
begin
  if new.run_id is null then
    new.run_sequence := null;
  elsif new.run_sequence is null
     or tg_op = 'INSERT'
     or old.run_id is distinct from new.run_id
  then
    select coalesce(max(run_sequence), 0) + 1
    into new.run_sequence
    from public.orders
    where run_id = new.run_id and id <> new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_set_run_sequence_trg on public.orders;
create trigger orders_set_run_sequence_trg
  before insert or update of run_id on public.orders
  for each row execute function public.orders_set_run_sequence();

-- ---------------------------------------------------------------------------
-- dispatch_reorder_run: the dispatcher hands over the full list of order ids
-- in the order the truck should drive them. Rewriting the whole run in one
-- statement is what keeps the sequence dense and free of ties -- a
-- move-one-row RPC would need a renumbering pass anyway.
--
-- A completed run is history; reordering it would rewrite the record of what
-- happened, so it is refused.
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_reorder_run(p_run uuid, p_order_ids uuid[])
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_status public.delivery_run_status;
  v_actual uuid[];
begin
  select organization_id, status into v_org, v_status
  from public.delivery_runs where id = p_run for update;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.has_org_role(v_org, array['owner', 'org_admin', 'seller', 'logistics']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_status = 'completed' then
    raise exception using errcode = 'P0001', message = 'run_completed';
  end if;

  -- The caller's list must be exactly the run's orders: a stale page that is
  -- missing an order would otherwise silently strand it at the end.
  select array_agg(id order by id) into v_actual
  from public.orders where run_id = p_run;

  if coalesce(v_actual, array[]::uuid[])
     is distinct from (select array_agg(x order by x) from unnest(p_order_ids) as x)
  then
    raise exception using errcode = 'P0001', message = 'invalid_order_set';
  end if;

  update public.orders o
  set run_sequence = position.ordinality
  from unnest(p_order_ids) with ordinality as position(order_id, ordinality)
  where o.id = position.order_id and o.run_id = p_run;
end;
$$;

revoke all on function public.dispatch_reorder_run(uuid, uuid[]) from public;
grant execute on function public.dispatch_reorder_run(uuid, uuid[]) to authenticated;

commit;
