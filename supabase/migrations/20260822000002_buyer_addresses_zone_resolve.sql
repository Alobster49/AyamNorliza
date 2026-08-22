-- 20260822000002_buyer_addresses_zone_resolve.sql
-- Buyer address book + postcode→zone resolution for the buyer portal.
-- Zones stay seller-defined; zone_postcode_ranges (existing) provides the
-- mapping. Overlap tie-break: first match by zone name, matching the
-- zone_postcode_ranges table comment.

begin;

-- ---------------------------------------------------------------------------
-- buyer_addresses
-- ---------------------------------------------------------------------------
create table if not exists public.buyer_addresses (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.buyers(id) on delete cascade,
  address_line text not null check (char_length(address_line) between 1 and 500),
  postcode text not null check (postcode ~ '^[0-9]{5}$'),
  state text not null check (char_length(state) between 1 and 50),
  area text not null check (char_length(area) between 1 and 100),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists buyer_addresses_buyer_idx on public.buyer_addresses(buyer_id);
create unique index if not exists buyer_addresses_one_default_idx
  on public.buyer_addresses(buyer_id) where is_default;

comment on table public.buyer_addresses is 'Saved delivery addresses per buyer; at most one default each.';

drop trigger if exists buyer_addresses_updated_at on public.buyer_addresses;
create trigger buyer_addresses_updated_at before update on public.buyer_addresses
  for each row execute function public.set_updated_at();

alter table public.buyer_addresses enable row level security;

create policy "buyer_addresses_select_own" on public.buyer_addresses
  for select using (buyer_id = auth.uid());
create policy "buyer_addresses_insert_own" on public.buyer_addresses
  for insert with check (buyer_id = auth.uid());
create policy "buyer_addresses_update_own" on public.buyer_addresses
  for update using (buyer_id = auth.uid()) with check (buyer_id = auth.uid());
create policy "buyer_addresses_delete_own" on public.buyer_addresses
  for delete using (buyer_id = auth.uid());

grant select, insert, update, delete on public.buyer_addresses to authenticated;

-- ---------------------------------------------------------------------------
-- resolve_zone_for_postcode
-- ---------------------------------------------------------------------------
create or replace function public.resolve_zone_for_postcode(
  p_org uuid,
  p_postcode text
)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_zone uuid;
begin
  if p_postcode is null or p_postcode !~ '^[0-9]{5}$' then
    raise exception using errcode = 'P0001', message = 'invalid_postcode';
  end if;

  select z.id
    into v_zone
  from public.zone_postcode_ranges r
  join public.delivery_zones z
    on z.id = r.zone_id
   and z.is_active = true
  where r.organization_id = p_org
    and r.postcode_start <= p_postcode
    and r.postcode_end >= p_postcode
  order by z.name asc
  limit 1;

  return v_zone; -- null when no match: "no delivery to your area"
end;
$$;

revoke all on function public.resolve_zone_for_postcode(uuid, text) from public;
grant execute on function public.resolve_zone_for_postcode(uuid, text) to authenticated;

commit;
