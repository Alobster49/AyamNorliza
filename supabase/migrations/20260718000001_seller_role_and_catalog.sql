-- 20260718000001_seller_role_and_catalog.sql
-- MOD-06: Add seller role and product catalog tables for AyamNorliza ordering system.

begin;

-- ---------------------------------------------------------------------------
-- Add 'seller' to organization_members role constraint
-- ---------------------------------------------------------------------------
alter table public.organization_members drop constraint if exists organization_members_role_check;
alter table public.organization_members add constraint organization_members_role_check
  check (role in (
    'owner','org_admin','seller','farm_manager','supervisor','caretaker',
    'veterinarian','biosecurity_qa','maintenance','inventory',
    'logistics','auditor','support'
  ));

-- ---------------------------------------------------------------------------
-- Add 'seller' to invitations role constraint
-- ---------------------------------------------------------------------------
alter table public.invitations drop constraint if exists invitations_role_check;
alter table public.invitations add constraint invitations_role_check
  check (role in (
    'owner','org_admin','seller','farm_manager','supervisor','caretaker',
    'veterinarian','biosecurity_qa','maintenance','inventory',
    'logistics','auditor','support'
  ));

-- ---------------------------------------------------------------------------
-- Add 'seller' to role_capability_overrides role constraint
-- ---------------------------------------------------------------------------
alter table public.role_capability_overrides drop constraint if exists role_capability_overrides_role_check;
alter table public.role_capability_overrides add constraint role_capability_overrides_role_check
  check (role in (
    'owner','org_admin','seller','farm_manager','supervisor','caretaker',
    'veterinarian','biosecurity_qa','maintenance','inventory',
    'logistics','auditor','support'
  ));

-- ---------------------------------------------------------------------------
-- categories: Product groupings (Whole Chicken, Frozen, etc.)
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  description text null check (char_length(description) <= 500),
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create index if not exists categories_org_idx on public.categories(organization_id);
create index if not exists categories_org_active_idx on public.categories(organization_id, is_active) where is_active = true;

comment on table public.categories is 'Product category groupings for the AyamNorliza catalog.';

-- ---------------------------------------------------------------------------
-- products: Individual products within categories
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 150),
  description text null check (char_length(description) <= 1000),
  image_url text null,
  is_active boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create index if not exists products_org_idx on public.products(organization_id);
create index if not exists products_category_idx on public.products(category_id);
create index if not exists products_org_active_idx on public.products(organization_id, is_active) where is_active = true;

comment on table public.products is 'Individual products available for ordering.';

-- ---------------------------------------------------------------------------
-- product_variants: Size/option variants with prices
-- ---------------------------------------------------------------------------
create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 50),
  price_per_unit numeric(10,2) not null check (price_per_unit >= 0),
  is_available boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create index if not exists product_variants_org_idx on public.product_variants(organization_id);
create index if not exists product_variants_product_idx on public.product_variants(product_id);

comment on table public.product_variants is 'Size/variant options for products with individual pricing.';

-- ---------------------------------------------------------------------------
-- customers: Customer records (phone customers, no login)
-- ---------------------------------------------------------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 150),
  phone text not null check (char_length(phone) between 5 and 20),
  address text null check (char_length(address) <= 500),
  notes text null check (char_length(notes) <= 1000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create index if not exists customers_org_idx on public.customers(organization_id);
create index if not exists customers_phone_idx on public.customers(phone);

comment on table public.customers is 'Customer records for phone/text orders (no login required).';

-- ---------------------------------------------------------------------------
-- orders: Order header with status tracking
-- ---------------------------------------------------------------------------
create type order_status as enum ('new', 'preparing', 'ready', 'completed', 'cancelled');

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  seller_id uuid not null references auth.users(id) on delete restrict,
  status order_status not null default 'new',
  total_amount numeric(12,2) not null default 0 check (total_amount >= 0),
  notes text null check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create index if not exists orders_org_idx on public.orders(organization_id);
create index if not exists orders_customer_idx on public.orders(customer_id);
create index if not exists orders_seller_idx on public.orders(seller_id);
create index if not exists orders_status_idx on public.orders(status);
create index if not exists orders_org_created_idx on public.orders(organization_id, created_at desc);

comment on table public.orders is 'Customer orders created by sellers.';

-- ---------------------------------------------------------------------------
-- order_items: Line items linking orders to variants
-- ---------------------------------------------------------------------------
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_price numeric(10,2) not null check (unit_price >= 0),
  subtotal numeric(12,2) not null check (subtotal >= 0),
  created_at timestamptz not null default now()
);

create index if not exists order_items_order_idx on public.order_items(order_id);

comment on table public.order_items is 'Line items for each order.';

-- ---------------------------------------------------------------------------
-- Auto-update timestamps
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Apply to tables with updated_at
drop trigger if exists categories_updated_at on public.categories;
create trigger categories_updated_at before update on public.categories
  for each row execute function public.set_updated_at();

drop trigger if exists products_updated_at on public.products;
create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();

drop trigger if exists product_variants_updated_at on public.product_variants;
create trigger product_variants_updated_at before update on public.product_variants
  for each row execute function public.set_updated_at();

drop trigger if exists customers_updated_at on public.customers;
create trigger customers_updated_at before update on public.customers
  for each row execute function public.set_updated_at();

drop trigger if exists orders_updated_at on public.orders;
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS Policies
-- ---------------------------------------------------------------------------
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Categories: org members can read, sellers/org_admins can write
create policy "categories_select" on public.categories
  for select using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
    )
  );

create policy "categories_insert" on public.categories
  for insert with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "categories_update" on public.categories
  for update using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

-- Products: same as categories
create policy "products_select" on public.products
  for select using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
    )
  );

create policy "products_insert" on public.products
  for insert with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "products_update" on public.products
  for update using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

-- Product variants: same as categories
create policy "product_variants_select" on public.product_variants
  for select using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
    )
  );

create policy "product_variants_insert" on public.product_variants
  for insert with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "product_variants_update" on public.product_variants
  for update using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

-- Customers: org members can read, sellers can manage
create policy "customers_select" on public.customers
  for select using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
    )
  );

create policy "customers_insert" on public.customers
  for insert with check (
    created_by = auth.uid()
    and organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "customers_update" on public.customers
  for update using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

-- Orders: org members can read, sellers can manage their own
create policy "orders_select" on public.orders
  for select using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
    )
  );

create policy "orders_insert" on public.orders
  for insert with check (
    seller_id = auth.uid()
    and organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "orders_update" on public.orders
  for update using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

-- Order items: readable by org members, manageable by sellers
create policy "order_items_select" on public.order_items
  for select using (
    order_id in (
      select id from public.orders
      where organization_id in (
        select organization_id from public.organization_members
        where user_id = auth.uid() and status = 'active'
      )
    )
  );

create policy "order_items_insert" on public.order_items
  for insert with check (
    order_id in (
      select id from public.orders
      where seller_id = auth.uid()
      and organization_id in (
        select organization_id from public.organization_members
        where user_id = auth.uid() and status = 'active'
        and role in ('owner', 'org_admin', 'seller')
      )
    )
  );

-- Audit log entries for catalog changes
create policy "audit_log_insert_catalog" on public.audit_log
  for insert with check (
    entity_type in ('category', 'product', 'product_variant', 'customer', 'order')
    and actor_user_id = auth.uid()
  );

commit;
