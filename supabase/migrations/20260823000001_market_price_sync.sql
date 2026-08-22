-- 20260823000001_market_price_sync.sql
-- KPDN PriceCatcher market data: premise lookup cache, daily state-level
-- aggregates, per-org settings, benchmark mapping on product variants,
-- and the suggestion RPC.
-- Spec: docs/superpowers/specs/2026-08-22-market-price-sync-design.md

-- ---------------------------------------------------------------------------
-- market_premises: cache of PriceCatcher lookup_premise.csv
-- ---------------------------------------------------------------------------
create table if not exists public.market_premises (
  premise_code integer primary key,
  state text not null,
  district text null,
  synced_at timestamptz not null default now()
);

comment on table public.market_premises is
  'Cache of KPDN PriceCatcher premise lookup (premise_code -> state/district). Refreshed by the market-price-sync edge function.';

-- ---------------------------------------------------------------------------
-- market_prices: one row per (day, item, state)
-- ---------------------------------------------------------------------------
create table if not exists public.market_prices (
  price_date date not null,
  item_code integer not null,
  state text not null,
  median_price numeric(10,2) not null,
  avg_price numeric(10,2) not null,
  min_price numeric(10,2) not null,
  max_price numeric(10,2) not null,
  premise_count integer not null,
  created_at timestamptz not null default now(),
  primary key (price_date, item_code, state)
);

create index if not exists market_prices_item_state_date_idx
  on public.market_prices (item_code, state, price_date desc);

comment on table public.market_prices is
  'Daily state-level aggregates of KPDN PriceCatcher retail prices for tracked chicken items (1=standard, 2=super, 3=live).';

-- ---------------------------------------------------------------------------
-- market_settings: per-org state selection
-- ---------------------------------------------------------------------------
create table if not exists public.market_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  states text[] not null default '{Selangor}',
  updated_at timestamptz not null default now()
);

comment on table public.market_settings is
  'Which PriceCatcher states feed an organization''s market price card. v1 UI writes a single-element array.';

-- ---------------------------------------------------------------------------
-- product_variants: benchmark mapping
-- ---------------------------------------------------------------------------
alter table public.product_variants
  add column if not exists market_item_code integer null,
  add column if not exists market_margin_type text null
    check (market_margin_type in ('rm', 'pct')),
  add column if not exists market_margin_value numeric(10,2) null;

comment on column public.product_variants.market_item_code is
  'PriceCatcher item code this variant benchmarks against (1/2/3); null = not tracked.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.market_premises enable row level security;
alter table public.market_prices enable row level security;
alter table public.market_settings enable row level security;

-- Reference data: any signed-in user may read; only service role writes
-- (service role bypasses RLS, so no write policies are defined).
create policy "market_premises_select" on public.market_premises
  for select to authenticated using (true);

create policy "market_prices_select" on public.market_prices
  for select to authenticated using (true);

-- Org-scoped settings, same shape as categories_* policies.
create policy "market_settings_select" on public.market_settings
  for select to authenticated using (
    org_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
    )
  );

create policy "market_settings_insert" on public.market_settings
  for insert to authenticated with check (
    org_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "market_settings_update" on public.market_settings
  for update to authenticated using (
    org_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

grant select on public.market_premises, public.market_prices to authenticated;
grant select, insert, update on public.market_settings to authenticated;
grant all on public.market_premises, public.market_prices, public.market_settings
  to service_role;

-- ---------------------------------------------------------------------------
-- get_market_suggestions: suggested price per mapped variant.
-- SECURITY INVOKER, but product_variants RLS does NOT scope this by itself:
-- product_variants_select_public (20260718120000_buyer_portal.sql) grants
-- anon/authenticated read of any *available* variant regardless of org, and
-- permissive policies OR together. The `mapped` CTE below adds an explicit
-- active-membership check against p_organization_id so a caller can only
-- ever see suggestions for an org they actually belong to.
-- ---------------------------------------------------------------------------
create or replace function public.get_market_suggestions(p_organization_id uuid)
returns table (
  variant_id uuid,
  variant_name text,
  product_name text,
  current_price numeric,
  market_item_code integer,
  market_base numeric,
  suggested_price numeric,
  latest_price_date date,
  stale boolean
)
language sql
stable
set search_path = public
as $$
  with org_states as (
    select coalesce(
      (select ms.states from public.market_settings ms
       where ms.org_id = p_organization_id),
      array['Selangor']
    ) as states
  ),
  mapped as (
    select pv.id, pv.name as variant_name, pr.name as product_name,
           pv.price_per_unit, pv.market_item_code,
           pv.market_margin_type, pv.market_margin_value
    from public.product_variants pv
    join public.products pr on pr.id = pv.product_id
    where pv.organization_id = p_organization_id
      and pv.market_item_code is not null
      and exists (
        select 1 from public.organization_members om
        where om.organization_id = p_organization_id
          and om.user_id = auth.uid()
          and om.status = 'active'
      )
  ),
  latest as (
    -- newest available date per item within the org's states
    select m.id as vid, max(mp.price_date) as max_date
    from mapped m
    cross join org_states os
    join public.market_prices mp
      on mp.item_code = m.market_item_code
     and mp.state = any(os.states)
    group by m.id
  ),
  base as (
    -- median of median_price over the 7-day window ending at max_date
    select l.vid,
           percentile_cont(0.5) within group (order by mp.median_price)
             ::numeric(10,2) as market_base,
           l.max_date
    from latest l
    join mapped m on m.id = l.vid
    cross join org_states os
    join public.market_prices mp
      on mp.item_code = m.market_item_code
     and mp.state = any(os.states)
     and mp.price_date > l.max_date - 7
     and mp.price_date <= l.max_date
    group by l.vid, l.max_date
  )
  select m.id, m.variant_name, m.product_name, m.price_per_unit,
         m.market_item_code,
         b.market_base,
         case
           when b.market_base is null then null
           when m.market_margin_type = 'pct'
             then round(b.market_base * (1 + coalesce(m.market_margin_value, 0) / 100), 2)
           else round(b.market_base + coalesce(m.market_margin_value, 0), 2)
         end as suggested_price,
         b.max_date,
         coalesce(b.max_date < current_date - 3, true) as stale
  from mapped m
  left join base b on b.vid = m.id
  order by m.product_name, m.variant_name;
$$;

grant execute on function public.get_market_suggestions(uuid) to authenticated;
