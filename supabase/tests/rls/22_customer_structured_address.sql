-- supabase/tests/rls/22_customer_structured_address.sql
-- Structured customer address: column checks, the state/area pairing
-- constraint, the extract_postcode() derivation, and the backfill guard.

begin;
select plan(15);

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
-- extract_postcode(): the pure function the migration's backfill calls.
-- Testing this directly means a future edit to the real backfill logic is
-- caught here, instead of a hand-pasted copy silently drifting from it.
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select public.extract_postcode('Unit 12345, 3 Jalan Bakri, 84000 Muar') $$,
  array['84000'::text],
  'extract_postcode takes the LAST 5-digit token, not the first ("12345" loses to "84000")'
);
select results_eq(
  $$ select public.extract_postcode('Lot 123456, Jalan Enam Angka') $$,
  array[null::text],
  'extract_postcode treats a 6-or-more digit run as not a postcode'
);
select results_eq(
  $$ select public.extract_postcode('Jalan Tanpa Nombor Langsung') $$,
  array[null::text],
  'extract_postcode returns null for an address with no digits'
);
select results_eq(
  $$ select public.extract_postcode('Kompleks Sentral, 81300 Skudai') $$,
  array['81300'::text],
  'extract_postcode returns the single 5-digit token an address contains'
);

-- ---------------------------------------------------------------------------
-- Backfill guard.
--
-- The brief for this test assumed a seeded address with an embedded postcode
-- would already exist in public.customers by the time this file runs, so the
-- backfill could be asserted against it directly. It doesn't: `supabase db
-- reset` applies migrations (including this one) BEFORE `supabase/seed.sql`
-- runs (see supabase/config.toml [db.seed], "Runs after migrations"), and
-- seed.sql's only customer row (the E2E pilot buyer) never sets `address` at
-- all. Confirmed empirically: after a clean reset public.customers has
-- exactly one row, address is null.
--
-- So this file exercises the backfill directly: insert fixture rows in this
-- transaction, then run the exact statement shape the migration runs (it
-- calls public.extract_postcode, so there is no extraction logic to drift
-- out of sync here) once, and assert on the result -- including that a
-- seller-corrected postcode is never clobbered.
-- ---------------------------------------------------------------------------
insert into public.customers (organization_id, name, phone, address, created_by)
values
  ('f0000000-0000-0000-0000-0000000000ff', 'Backfill Last Token', '0111111117',
   'Unit 12345, 3 Jalan Bakri, 84000 Muar', 'e0000000-0000-0000-0000-0000000000ee');

insert into public.customers (organization_id, name, phone, address, postcode, created_by)
values
  ('f0000000-0000-0000-0000-0000000000ff', 'Guard Explicit Postcode', '0111111119',
   '5 Jalan Tekad, 79100 Iskandar Puteri', '50000', 'e0000000-0000-0000-0000-0000000000ee');

update public.customers
set postcode = public.extract_postcode(address)
where address is not null
  and postcode is null
  and public.extract_postcode(address) is not null;

select results_eq(
  $$ select postcode from public.customers where address = 'Unit 12345, 3 Jalan Bakri, 84000 Muar' $$,
  array['84000'::text],
  'the backfill statement applies extract_postcode to a null-postcode row'
);
select ok(
  (select state is null and area is null
     from public.customers
    where address = 'Unit 12345, 3 Jalan Bakri, 84000 Muar'),
  'backfill does not invent state or area (SQL cannot read the dataset)'
);
select results_eq(
  $$ select postcode from public.customers where name = 'Guard Explicit Postcode' $$,
  array['50000'::text],
  'the "postcode is null" guard leaves a seller-corrected postcode unchanged even though the address has its own 5-digit token'
);

-- ---------------------------------------------------------------------------
-- admin_seed_demo_data (20260823000009) derives a postcode for its demo
-- customers instead of leaving the column null: it now calls the same
-- extract_postcode() this file already tests directly, against the same
-- embedded-postcode address it has always written. Prove that end-to-end by
-- actually calling the RPC in this transaction, the way
-- supabase/tests/rls/16_data_console.sql does.
-- ---------------------------------------------------------------------------
insert into public.organization_members (organization_id, user_id, role, status)
values ('f0000000-0000-0000-0000-0000000000ff', 'e0000000-0000-0000-0000-0000000000ee', 'org_admin', 'active')
on conflict (organization_id, user_id) do nothing;

create or replace function pg_temp.impersonate(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$$;

select pg_temp.impersonate('e0000000-0000-0000-0000-0000000000ee');
select lives_ok(
  $$ select public.admin_seed_demo_data('f0000000-0000-0000-0000-0000000000ff') $$,
  'org_admin can seed demo data (also wipes this org''s earlier fixture rows -- run last)'
);

select set_config('role', 'postgres', true);
select results_eq(
  $$ select postcode from public.customers
     where organization_id = 'f0000000-0000-0000-0000-0000000000ff'
       and phone = '019-7551122' $$,
  array['84000'::text],
  'a demo-seeded customer (Kak Ros Catering, "...3 Jalan Bakri, 84000 Muar") carries a derived postcode'
);

select * from finish();
rollback;
