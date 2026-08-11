-- 20260810000001_order_pipeline_schema.sql
-- Order pipeline: scheduling (zones/trucks/slots/blocks), unified orders
-- (portal + manual), and ops extras (tasks/runs/weight log). Replaces the
-- old orders/order_items (seller) and buyer_orders/buyer_order_items
-- (portal) tables and order_status enum -- dev data only, dropped freely.

begin;

-- ---------------------------------------------------------------------------
-- Drop old order shapes
-- ---------------------------------------------------------------------------
drop table if exists public.buyer_order_items;
drop table if exists public.buyer_orders;
drop table if exists public.order_items;
drop table if exists public.orders;
drop type if exists public.order_status;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.order_status as enum ('pending','confirmed','ready','delivered','closed','cancelled');
create type public.order_item_mode as enum ('piece','kg');
create type public.order_fallback as enum ('cancel','mix','upsize','downsize');
create type public.order_task_status as enum ('pending','done');
create type public.delivery_run_status as enum ('planned','departed','completed');
create type public.weight_log_kind as enum ('warehouse','final');

-- ---------------------------------------------------------------------------
-- delivery_zones
-- ---------------------------------------------------------------------------
create table if not exists public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create index if not exists delivery_zones_org_idx on public.delivery_zones(organization_id);
create index if not exists delivery_zones_org_active_idx on public.delivery_zones(organization_id, is_active) where is_active = true;

comment on table public.delivery_zones is 'Fixed delivery location zones customers pick at checkout.';

drop trigger if exists delivery_zones_updated_at on public.delivery_zones;
create trigger delivery_zones_updated_at before update on public.delivery_zones
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- trucks
-- ---------------------------------------------------------------------------
create table if not exists public.trucks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  code text not null check (char_length(code) between 1 and 20),
  is_active boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique(organization_id, code)
);

create index if not exists trucks_org_idx on public.trucks(organization_id);

comment on table public.trucks is 'Delivery trucks; each truck is one loading bay ("lot bay").';

drop trigger if exists trucks_updated_at on public.trucks;
create trigger trucks_updated_at before update on public.trucks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- truck_zones
-- ---------------------------------------------------------------------------
create table if not exists public.truck_zones (
  truck_id uuid not null references public.trucks(id) on delete cascade,
  zone_id uuid not null references public.delivery_zones(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  primary key (truck_id, zone_id)
);

create index if not exists truck_zones_zone_idx on public.truck_zones(zone_id);

comment on table public.truck_zones is 'Coverage join: which trucks deliver to which zones.';

-- ---------------------------------------------------------------------------
-- delivery_slots
-- ---------------------------------------------------------------------------
create table if not exists public.delivery_slots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  truck_id uuid not null references public.trucks(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  max_orders integer null check (max_orders > 0),
  is_active boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  check (end_time > start_time)
);

create index if not exists delivery_slots_truck_idx on public.delivery_slots(truck_id);
create index if not exists delivery_slots_org_idx on public.delivery_slots(organization_id);

comment on table public.delivery_slots is 'Weekly recurring delivery time windows per truck (weekday 0=Sunday, JS Date.getDay convention).';

drop trigger if exists delivery_slots_updated_at on public.delivery_slots;
create trigger delivery_slots_updated_at before update on public.delivery_slots
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- schedule_blocks
-- ---------------------------------------------------------------------------
create table if not exists public.schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  block_date date not null,
  truck_id uuid null references public.trucks(id) on delete cascade,
  reason text null check (char_length(reason) <= 200),
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(organization_id, block_date, truck_id)
);

create index if not exists schedule_blocks_org_date_idx on public.schedule_blocks(organization_id, block_date);

comment on table public.schedule_blocks is 'One-off blocked dates; truck_id null blocks all trucks for the org that date.';

-- ---------------------------------------------------------------------------
-- delivery_runs
-- ---------------------------------------------------------------------------
create table if not exists public.delivery_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  truck_id uuid not null references public.trucks(id) on delete restrict,
  run_date date not null,
  status public.delivery_run_status not null default 'planned',
  notes text null check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique(truck_id, run_date)
);

create index if not exists delivery_runs_org_date_idx on public.delivery_runs(organization_id, run_date);

comment on table public.delivery_runs is 'A truck''s manifest for one delivery date; created on demand when the first order is confirmed onto it.';

drop trigger if exists delivery_runs_updated_at on public.delivery_runs;
create trigger delivery_runs_updated_at before update on public.delivery_runs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  created_by uuid null references auth.users(id) on delete set null,
  source text not null default 'portal' check (source in ('portal','manual')),
  status public.order_status not null default 'pending',
  zone_id uuid not null references public.delivery_zones(id) on delete restrict,
  delivery_address text not null check (char_length(delivery_address) <= 500),
  delivery_date date not null,
  slot_id uuid not null references public.delivery_slots(id) on delete restrict,
  truck_id uuid not null references public.trucks(id) on delete restrict,
  run_id uuid null references public.delivery_runs(id) on delete set null,
  notes text null check (char_length(notes) <= 2000),
  total_amount numeric(12,2) not null default 0 check (total_amount >= 0),
  closed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create index if not exists orders_org_idx on public.orders(organization_id);
create index if not exists orders_customer_idx on public.orders(customer_id);
create index if not exists orders_status_idx on public.orders(status);
create index if not exists orders_org_created_idx on public.orders(organization_id, created_at desc);
create index if not exists orders_slot_date_idx on public.orders(slot_id, delivery_date);
create index if not exists orders_run_idx on public.orders(run_id);

comment on table public.orders is 'Unified order pipeline for portal (buyer) and manual (manager) orders. All writes go through security-definer RPCs.';

drop trigger if exists orders_updated_at on public.orders;
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- order_items
-- ---------------------------------------------------------------------------
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  mode public.order_item_mode not null,
  quantity numeric(10,3) not null check (quantity > 0),
  size_min_kg numeric(6,3) not null check (size_min_kg > 0),
  size_max_kg numeric(6,3) not null,
  fallback public.order_fallback not null,
  fallback_applied public.order_fallback null,
  is_cancelled boolean not null default false,
  warehouse_weight_kg numeric(10,3) null check (warehouse_weight_kg > 0),
  warehouse_pieces integer null check (warehouse_pieces > 0),
  final_weight_kg numeric(10,3) null check (final_weight_kg > 0),
  final_pieces integer null check (final_pieces > 0),
  price_per_kg numeric(10,2) null check (price_per_kg >= 0),
  line_total numeric(12,2) generated always as (
    case when final_weight_kg is not null and price_per_kg is not null
      then round(final_weight_kg * price_per_kg, 2)
      else null
    end
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  check (size_max_kg >= size_min_kg)
);

create index if not exists order_items_order_idx on public.order_items(order_id);

comment on table public.order_items is 'Order line items: mode (piece/kg), declared size range, and pre-declared fallback.';

drop trigger if exists order_items_updated_at on public.order_items;
create trigger order_items_updated_at before update on public.order_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- order_tasks
-- ---------------------------------------------------------------------------
create table if not exists public.order_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  type text not null default 'allocate_weigh' check (type in ('allocate_weigh')),
  assigned_to uuid null references auth.users(id) on delete set null,
  status public.order_task_status not null default 'pending',
  done_by uuid null references auth.users(id) on delete set null,
  done_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique(order_id, type)
);

create index if not exists order_tasks_org_status_idx on public.order_tasks(organization_id, status);

comment on table public.order_tasks is 'Warehouse staff assignment: allocate stock to the truck bay and weigh it. All writes go through security-definer RPCs.';

drop trigger if exists order_tasks_updated_at on public.order_tasks;
create trigger order_tasks_updated_at before update on public.order_tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- order_weight_log
-- ---------------------------------------------------------------------------
create table if not exists public.order_weight_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  kind public.weight_log_kind not null,
  weight_kg numeric(10,3) not null check (weight_kg > 0),
  pieces integer null check (pieces > 0),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now()
);

create index if not exists order_weight_log_item_idx on public.order_weight_log(order_item_id);

comment on table public.order_weight_log is 'Append-only audit trail of warehouse and final weight/piece readings. No update/delete policies -- all writes go through security-definer RPCs.';

-- ---------------------------------------------------------------------------
-- buyers.customer_id -- link a portal account to its CRM customer row
-- ---------------------------------------------------------------------------
alter table public.buyers add column if not exists customer_id uuid null references public.customers(id) on delete set null;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.delivery_zones enable row level security;
alter table public.trucks enable row level security;
alter table public.truck_zones enable row level security;
alter table public.delivery_slots enable row level security;
alter table public.schedule_blocks enable row level security;
alter table public.delivery_runs enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_tasks enable row level security;
alter table public.order_weight_log enable row level security;

-- delivery_zones: org members read all; public (incl. anon) reads active only; managers write.
create policy "delivery_zones_select" on public.delivery_zones
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
    )
  );

create policy "delivery_zones_select_public" on public.delivery_zones
  for select to anon, authenticated using (is_active = true);

create policy "delivery_zones_insert" on public.delivery_zones
  for insert to authenticated with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "delivery_zones_update" on public.delivery_zones
  for update to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "delivery_zones_delete" on public.delivery_zones
  for delete to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin', 'seller')
    )
  );

-- trucks: org members read; managers write.
create policy "trucks_select" on public.trucks
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
    )
  );

create policy "trucks_insert" on public.trucks
  for insert to authenticated with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "trucks_update" on public.trucks
  for update to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "trucks_delete" on public.trucks
  for delete to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin', 'seller')
    )
  );

-- truck_zones: org members read; managers insert/delete.
create policy "truck_zones_select" on public.truck_zones
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
    )
  );

create policy "truck_zones_insert" on public.truck_zones
  for insert to authenticated with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "truck_zones_delete" on public.truck_zones
  for delete to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin', 'seller')
    )
  );

-- delivery_slots: org members read; managers write.
create policy "delivery_slots_select" on public.delivery_slots
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
    )
  );

create policy "delivery_slots_insert" on public.delivery_slots
  for insert to authenticated with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "delivery_slots_update" on public.delivery_slots
  for update to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "delivery_slots_delete" on public.delivery_slots
  for delete to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin', 'seller')
    )
  );

-- schedule_blocks: org members read; managers insert/delete (no update).
create policy "schedule_blocks_select" on public.schedule_blocks
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
    )
  );

create policy "schedule_blocks_insert" on public.schedule_blocks
  for insert to authenticated with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "schedule_blocks_delete" on public.schedule_blocks
  for delete to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin', 'seller')
    )
  );

-- delivery_runs: org members read only; all writes via RPC.
create policy "delivery_runs_select" on public.delivery_runs
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
    )
  );

-- orders: org members read; buyers read their own; all writes via RPC.
create policy "orders_select_member" on public.orders
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
    )
  );

create policy "orders_select_buyer" on public.orders
  for select to authenticated using (created_by = auth.uid());

-- order_items: readable via the parent order's visibility; all writes via RPC.
create policy "order_items_select_member" on public.order_items
  for select to authenticated using (
    order_id in (
      select id from public.orders
      where organization_id in (
        select organization_id from public.organization_members
        where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      )
    )
  );

create policy "order_items_select_buyer" on public.order_items
  for select to authenticated using (
    order_id in (
      select id from public.orders where created_by = auth.uid()
    )
  );

-- order_tasks: org members read only; all writes via RPC.
create policy "order_tasks_select" on public.order_tasks
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
    )
  );

-- order_weight_log: org members read only; append-only via RPC (no write policies).
create policy "order_weight_log_select" on public.order_weight_log
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
    )
  );

-- ---------------------------------------------------------------------------
-- Grants
--
-- CONTRACT CONCERN: the contract says "No explicit table GRANTs (Supabase
-- default grants apply)" -- verified empirically against the local stack
-- that this is false for tables owned by the migration role (`postgres`):
-- anon/authenticated get "permission denied for table X" (42501) at the
-- GRANT layer, before RLS is even evaluated, exactly like `products`,
-- `customers`, `orders` (old), and `buyers` do today (unexercised by any
-- test). The working precedent is `supabase/migrations/20260624000002_id_
-- access_rls.sql` / `20260625000005_id_access_and_structure_grants.sql`,
-- which issue explicit `grant select, insert, update, delete on <table> to
-- authenticated;` (and `grant select ... to anon` for public-read tables)
-- per table. This migration follows THAT precedent instead so the RLS
-- policies above are actually reachable; see the note at the end of this
-- plan file for the follow-up recommendation on the older catalog tables.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on
  public.delivery_zones,
  public.trucks,
  public.truck_zones,
  public.delivery_slots,
  public.schedule_blocks
to authenticated;

grant select on
  public.delivery_runs,
  public.orders,
  public.order_items,
  public.order_tasks,
  public.order_weight_log
to authenticated;

grant select on public.delivery_zones to anon;

commit;
