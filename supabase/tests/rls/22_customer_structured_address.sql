-- supabase/tests/rls/22_customer_structured_address.sql
-- Structured customer address: column checks, the state/area pairing
-- constraint, and the one-time postcode backfill.

begin;
select plan(9);

insert into auth.users (id) values
  ('e0000000-0000-0000-0000-0000000000ee')
on conflict (id) do nothing;

insert into public.organizations (id, name, slug)
values ('f0000000-0000-0000-0000-0000000000ff', 'Addr Test Org', 'addr-test-org')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Legal shapes
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.customers (organization_id, name, phone, created_by)
     values ('f0000000-0000-0000-0000-0000000000ff', 'No Address', '0111111111',
             'e0000000-0000-0000-0000-0000000000ee') $$,
  'a customer with no address at all is accepted'
);
select lives_ok(
  $$ insert into public.customers (organization_id, name, phone, address, created_by)
     values ('f0000000-0000-0000-0000-0000000000ff', 'Address Only', '0111111112',
             '9 Jalan Tanpa Poskod', 'e0000000-0000-0000-0000-0000000000ee') $$,
  'a legacy address-only customer is accepted'
);
select lives_ok(
  $$ insert into public.customers (organization_id, name, phone, address, postcode, state, area, created_by)
     values ('f0000000-0000-0000-0000-0000000000ff', 'Full Address', '0111111113',
             '1 Jalan Penuh', '80000', 'Johor', 'Johor Bahru',
             'e0000000-0000-0000-0000-0000000000ee') $$,
  'a complete structured address is accepted'
);

-- ---------------------------------------------------------------------------
-- Illegal shapes
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.customers (organization_id, name, phone, address, postcode, state, created_by)
     values ('f0000000-0000-0000-0000-0000000000ff', 'State No Area', '0111111114',
             '2 Jalan Separa', '80000', 'Johor', 'e0000000-0000-0000-0000-0000000000ee') $$,
  '23514',
  null,
  'a state without an area is rejected'
);
select throws_ok(
  $$ insert into public.customers (organization_id, name, phone, address, state, area, created_by)
     values ('f0000000-0000-0000-0000-0000000000ff', 'No Postcode', '0111111115',
             '3 Jalan Separa', 'Johor', 'Johor Bahru', 'e0000000-0000-0000-0000-0000000000ee') $$,
  '23514',
  null,
  'state and area without a postcode are rejected'
);
select throws_ok(
  $$ insert into public.customers (organization_id, name, phone, address, postcode, created_by)
     values ('f0000000-0000-0000-0000-0000000000ff', 'Bad Postcode', '0111111116',
             '4 Jalan Salah', '8000', 'e0000000-0000-0000-0000-0000000000ee') $$,
  '23514',
  null,
  'a postcode that is not five digits is rejected'
);

-- ---------------------------------------------------------------------------
-- Backfill.
--
-- The brief for this test assumed a seeded address with an embedded postcode
-- would already exist in public.customers by the time this file runs, so the
-- backfill could be asserted against it directly. It doesn't: `supabase db
-- reset` applies migrations (including this one) BEFORE `supabase/seed.sql`
-- runs (see supabase/config.toml [db.seed], "Runs after migrations"), and
-- seed.sql's only customer row (the E2E pilot buyer) never sets `address` at
-- all. Confirmed empirically: after a clean reset public.customers has
-- exactly one row, address is null. The only addresses containing postcodes
-- anywhere in the repo live inside the `admin_seed_demo_data()` function
-- body (20260823000007) -- literal SQL text, not rows the backfill migration
-- ever sees, since that function must be explicitly called to insert them.
--
-- So this file exercises the backfill directly: insert address-only rows in
-- this transaction, then re-run the exact same UPDATE the migration runs
-- (idempotent by construction, so running it here is equivalent to letting
-- the migration process these rows) and assert on the result. Keep this
-- statement byte-for-byte in sync with the backfill in
-- 20260823000008_customer_structured_address.sql.
-- ---------------------------------------------------------------------------
insert into public.customers (organization_id, name, phone, address, created_by)
values
  ('f0000000-0000-0000-0000-0000000000ff', 'Backfill Last Token', '0111111117',
   'Unit 12345, 3 Jalan Bakri, 84000 Muar', 'e0000000-0000-0000-0000-0000000000ee'),
  ('f0000000-0000-0000-0000-0000000000ff', 'Backfill No Token', '0111111118',
   '6 Jalan Tiada Nombor', 'e0000000-0000-0000-0000-0000000000ee');

-- Run twice to demonstrate the backfill is idempotent (second pass touches
-- zero rows because postcode is no longer null).
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

select results_eq(
  $$ select postcode from public.customers where address = 'Unit 12345, 3 Jalan Bakri, 84000 Muar' $$,
  array['84000'::text],
  'backfill takes the LAST 5-digit token, not the first ("12345" loses to "84000")'
);
select ok(
  (select count(*) from public.customers
    where address is not null
      and address ~ '\m[0-9]{5}\M'
      and postcode is null) = 0,
  'every address containing a 5-digit token was backfilled, none left unparsed'
);
select ok(
  (select state is null and area is null
     from public.customers
    where address = 'Unit 12345, 3 Jalan Bakri, 84000 Muar'),
  'backfill does not invent state or area (SQL cannot read the dataset)'
);

select * from finish();
rollback;
