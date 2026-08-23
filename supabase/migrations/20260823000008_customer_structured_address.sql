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
-- Backfill: pull a standalone 5-digit token out of the free-text address.
-- Malaysian addresses put the postcode near the end, so the LAST match wins
-- ("31 Jalan Sutera Tanjung 8/2, 81300 Skudai" -> 81300, not 8). State and
-- area are not backfilled: the postcode dataset is a vendored JSON file, not
-- a table, so SQL cannot resolve them. The edit dialog completes them on open.
-- Idempotent: only touches rows whose postcode is still null.
-- ---------------------------------------------------------------------------
update public.customers c
set postcode = sub.pc
from (
  select c2.id,
         (select m[1]
            from regexp_matches(c2.address, '\m([0-9]{5})\M', 'g')
                 with ordinality as t(m, ord)
           order by t.ord desc
           limit 1) as pc
  from public.customers c2
  where c2.address is not null
    and c2.postcode is null
) sub
where c.id = sub.id
  and sub.pc is not null;
