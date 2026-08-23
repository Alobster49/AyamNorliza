-- Structured Malaysian address on customers: the same shape buyers already
-- get at checkout (address line, postcode, state, area).
-- Spec: docs/superpowers/specs/2026-08-23-customer-structured-address-design.md

alter table public.customers
  add column if not exists postcode text null
    check (postcode is null or postcode ~ '^[0-9]{5}$'),
  add column if not exists state text null
    check (state is null or char_length(state) between 1 and 50),
  add column if not exists area text null
    check (area is null or char_length(area) between 1 and 100);

-- State and area only ever arrive together, and only ever derived from a
-- postcode. Address-alone stays legal: legacy rows predate this column set
-- and must remain editable.
alter table public.customers drop constraint if exists customers_address_parts_ck;
alter table public.customers add constraint customers_address_parts_ck check (
  (state is null and area is null)
  or (state is not null and area is not null and postcode is not null)
);

comment on column public.customers.postcode is
  'Delivery postcode; drives zone resolution on the manual order screen.';

-- ---------------------------------------------------------------------------
-- extract_postcode: pull a delivery postcode out of a free-text address.
-- Malaysian addresses put the postcode near the end, so the LAST standalone
-- 5-digit token wins ("31 Jalan Sutera Tanjung 8/2, 81300 Skudai" -> 81300,
-- never 8). A 6-or-more digit run is not a postcode and yields null.
-- ---------------------------------------------------------------------------
create or replace function public.extract_postcode(p_address text)
returns text
language sql
immutable
as $$
  select m[1]
  from regexp_matches(coalesce(p_address, ''), '\m([0-9]{5})\M', 'g')
       with ordinality as t(m, ord)
  order by t.ord desc
  limit 1
$$;

revoke execute on function public.extract_postcode(text) from public, anon, authenticated;

-- One-time backfill of existing free-text addresses. State and area are not
-- backfilled: the postcode dataset is a vendored JSON file, not a table, so
-- SQL cannot resolve them — the edit dialog completes them on open.
-- Idempotent: only rows whose postcode is still null are touched, so a
-- seller-corrected postcode is never overwritten.
update public.customers
set postcode = public.extract_postcode(address)
where address is not null
  and postcode is null
  and public.extract_postcode(address) is not null;
