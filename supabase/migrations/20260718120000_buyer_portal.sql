-- 20260718120000_buyer_portal.sql
-- MOD-07: Buyer portal tables and authentication.

begin;

-- ---------------------------------------------------------------------------
-- buyers: Buyer user accounts linked to organizations
-- ---------------------------------------------------------------------------
create table if not exists public.buyers (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 150),
  address text null check (char_length(address) <= 500),
  phone text null check (char_length(phone) between 5 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique(organization_id, id)
);

create index if not exists buyers_org_idx on public.buyers(organization_id);
create index if not exists buyers_user_idx on public.buyers(id);

comment on table public.buyers is 'Buyer user accounts with profile information.';

-- ---------------------------------------------------------------------------
-- Auto-update timestamp for buyers
-- ---------------------------------------------------------------------------
drop trigger if exists buyers_updated_at on public.buyers;
create trigger buyers_updated_at before update on public.buyers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- buyer_orders: Orders placed by buyers
-- ---------------------------------------------------------------------------
create table if not exists public.buyer_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  buyer_id uuid not null references public.buyers(id) on delete restrict,
  status order_status not null default 'new',
  total_amount numeric(12,2) not null default 0 check (total_amount >= 0),
  delivery_address text null check (char_length(delivery_address) <= 500),
  notes text null check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create index if not exists buyer_orders_org_idx on public.buyer_orders(organization_id);
create index if not exists buyer_orders_buyer_idx on public.buyer_orders(buyer_id);
create index if not exists buyer_orders_status_idx on public.buyer_orders(status);
create index if not exists buyer_orders_created_idx on public.buyer_orders(buyer_id, created_at desc);

comment on table public.buyer_orders is 'Orders placed by buyers through the public portal.';

-- ---------------------------------------------------------------------------
-- Auto-update timestamp for buyer_orders
-- ---------------------------------------------------------------------------
drop trigger if exists buyer_orders_updated_at on public.buyer_orders;
create trigger buyer_orders_updated_at before update on public.buyer_orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- buyer_order_items: Line items for buyer orders
-- ---------------------------------------------------------------------------
create table if not exists public.buyer_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.buyer_orders(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_price numeric(10,2) not null check (unit_price >= 0),
  subtotal numeric(12,2) not null check (subtotal >= 0),
  created_at timestamptz not null default now()
);

create index if not exists buyer_order_items_order_idx on public.buyer_order_items(order_id);

comment on table public.buyer_order_items is 'Line items for buyer orders.';

-- ---------------------------------------------------------------------------
-- RLS Policies for buyers table
-- ---------------------------------------------------------------------------
alter table public.buyers enable row level security;

-- Buyers can read their own record
create policy "buyers_select_own" on public.buyers
  for select using (id = auth.uid());

-- Buyers can update their own profile
create policy "buyers_update_own" on public.buyers
  for update using (id = auth.uid());

-- Any authenticated user can insert (for signup)
create policy "buyers_insert" on public.buyers
  for insert with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- RLS Policies for buyer_orders table
-- ---------------------------------------------------------------------------
alter table public.buyer_orders enable row level security;

-- Buyers can read their own orders
create policy "buyer_orders_select_own" on public.buyer_orders
  for select using (buyer_id = auth.uid());

-- Buyers can create orders (checked via buyer_id match)
create policy "buyer_orders_insert" on public.buyer_orders
  for insert with check (buyer_id = auth.uid());

-- Buyers can update their own orders (only for cancellation)
create policy "buyer_orders_update_own" on public.buyer_orders
  for update using (
    buyer_id = auth.uid()
    and status = 'new'
  );

-- ---------------------------------------------------------------------------
-- RLS Policies for buyer_order_items table
-- ---------------------------------------------------------------------------
alter table public.buyer_order_items enable row level security;

-- Buyers can read items for their own orders
create policy "buyer_order_items_select_own" on public.buyer_order_items
  for select using (
    order_id in (
      select id from public.buyer_orders
      where buyer_id = auth.uid()
    )
  );

-- Buyers can insert items for their own orders
create policy "buyer_order_items_insert_own" on public.buyer_order_items
  for insert with check (
    order_id in (
      select id from public.buyer_orders
      where buyer_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Public read access for catalog (for unauthenticated browsing)
-- Note: Product variants need to be readable without auth for the catalog
-- ---------------------------------------------------------------------------
create policy "product_variants_select_public" on public.product_variants
  for select using (is_available = true);

create policy "products_select_public" on public.products
  for select using (is_active = true);

create policy "categories_select_public" on public.categories
  for select using (is_active = true);

-- ---------------------------------------------------------------------------
-- Allow sellers to see buyer_orders for order management
-- ---------------------------------------------------------------------------
create policy "buyer_orders_select_seller" on public.buyer_orders
  for select using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "buyer_orders_update_seller" on public.buyer_orders
  for update using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "buyer_order_items_select_seller" on public.buyer_order_items
  for select using (
    order_id in (
      select id from public.buyer_orders
      where organization_id in (
        select organization_id from public.organization_members
        where user_id = auth.uid() and status = 'active'
        and role in ('owner', 'org_admin', 'seller')
      )
    )
  );

-- Allow buyers table to be readable by sellers for reporting
create policy "buyers_select_seller" on public.buyers
  for select using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

commit;
