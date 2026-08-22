-- supabase/tests/rls/21_customer_buyer_sync.sql
-- Customer–buyer sync: normalize_phone, signup trigger link-or-create,
-- email fill rules, no-steal, idempotency, function grants.

begin;
select plan(18);

-- ---------------------------------------------------------------------------
-- normalize_phone
-- ---------------------------------------------------------------------------
select is(public.normalize_phone('012-722 3344'), '0127223344', 'dashes and spaces stripped');
select is(public.normalize_phone('+60127223344'), '0127223344', 'E.164 collapses to national format');
select is(public.normalize_phone('0127223344'), '0127223344', 'national format unchanged');
select is(public.normalize_phone(null), '', 'null becomes empty string');

-- ---------------------------------------------------------------------------
-- Seed: org, seller, one admin-created customer, one customer with email set.
-- Superuser context bypasses RLS for seeding (same as other test files).
-- ---------------------------------------------------------------------------
insert into auth.users (id) values
  ('a0000000-0000-0000-0000-0000000000aa')            -- seller
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('b0000000-0000-0000-0000-0000000000b1', 'buyer1@example.com'),
  ('b0000000-0000-0000-0000-0000000000b2', 'buyer2@example.com'),
  ('b0000000-0000-0000-0000-0000000000b3', 'buyer3@example.com'),
  ('b0000000-0000-0000-0000-0000000000b4', 'buyer4@example.com')
on conflict (id) do nothing;

insert into public.organizations (id, name, slug)
values ('c0000000-0000-0000-0000-0000000000cc', 'Sync Test Org', 'sync-test-org')
on conflict (id) do nothing;

insert into public.customers (id, organization_id, name, phone, created_by)
values ('d0000000-0000-0000-0000-0000000000d1',
        'c0000000-0000-0000-0000-0000000000cc',
        'Ayamas Frozen Mart', '012-722 3344',
        'a0000000-0000-0000-0000-0000000000aa');

insert into public.customers (id, organization_id, name, phone, email, created_by)
values ('d0000000-0000-0000-0000-0000000000d2',
        'c0000000-0000-0000-0000-0000000000cc',
        'Kedai Emel Tetap', '013-999 8877', 'owner@fixed.my',
        'a0000000-0000-0000-0000-0000000000aa');

-- ---------------------------------------------------------------------------
-- Buyer 1 signs up with the E.164 form of customer d1's phone: auto-link.
-- ---------------------------------------------------------------------------
insert into public.buyers (id, organization_id, display_name, phone)
values ('b0000000-0000-0000-0000-0000000000b1',
        'c0000000-0000-0000-0000-0000000000cc', 'Buyer One', '+60127223344');

select results_eq(
  $$ select customer_id from public.buyers where id = 'b0000000-0000-0000-0000-0000000000b1' $$,
  array['d0000000-0000-0000-0000-0000000000d1'::uuid],
  'phone match links buyer to existing customer'
);
select results_eq(
  $$ select count(*)::int from public.customers
     where organization_id = 'c0000000-0000-0000-0000-0000000000cc'
       and phone_normalized = '0127223344' $$,
  array[1],
  'no duplicate customer row created on match'
);
select results_eq(
  $$ select email from public.customers where id = 'd0000000-0000-0000-0000-0000000000d1' $$,
  array['buyer1@example.com'],
  'null customer email filled from auth.users'
);
select results_eq(
  $$ select name from public.customers where id = 'd0000000-0000-0000-0000-0000000000d1' $$,
  array['Ayamas Frozen Mart'],
  'seller-entered name never overwritten'
);

-- ---------------------------------------------------------------------------
-- Buyer 2, same phone: d1 is claimed, so a NEW row is created (no stealing).
-- ---------------------------------------------------------------------------
insert into public.buyers (id, organization_id, display_name, phone)
values ('b0000000-0000-0000-0000-0000000000b2',
        'c0000000-0000-0000-0000-0000000000cc', 'Buyer Two', '0127223344');

select ok(
  (select customer_id from public.buyers where id = 'b0000000-0000-0000-0000-0000000000b2')
    is distinct from 'd0000000-0000-0000-0000-0000000000d1'::uuid
  and (select customer_id from public.buyers where id = 'b0000000-0000-0000-0000-0000000000b2')
    is not null,
  'claimed customer is not stolen; second buyer gets a fresh row'
);
select results_eq(
  $$ select count(*)::int from public.customers
     where organization_id = 'c0000000-0000-0000-0000-0000000000cc'
       and phone_normalized = '0127223344' $$,
  array[2],
  'second buyer created a second customer row'
);
select results_eq(
  $$ select c.name from public.customers c
     join public.buyers b on b.customer_id = c.id
     where b.id = 'b0000000-0000-0000-0000-0000000000b2' $$,
  array['Buyer Two'],
  'created row takes the buyer display name'
);

-- ---------------------------------------------------------------------------
-- Buyer 3 matches d2, whose email is already set: email preserved.
-- ---------------------------------------------------------------------------
insert into public.buyers (id, organization_id, display_name, phone)
values ('b0000000-0000-0000-0000-0000000000b3',
        'c0000000-0000-0000-0000-0000000000cc', 'Buyer Three', '0139998877');

select results_eq(
  $$ select email from public.customers where id = 'd0000000-0000-0000-0000-0000000000d2' $$,
  array['owner@fixed.my'],
  'existing customer email never overwritten'
);

-- ---------------------------------------------------------------------------
-- Buyer 4 has no phone: a row is still created and linked.
-- ---------------------------------------------------------------------------
insert into public.buyers (id, organization_id, display_name)
values ('b0000000-0000-0000-0000-0000000000b4',
        'c0000000-0000-0000-0000-0000000000cc', 'Buyer Four');

select ok(
  (select customer_id from public.buyers where id = 'b0000000-0000-0000-0000-0000000000b4') is not null,
  'phoneless buyer still gets a linked customer row'
);
select results_eq(
  $$ select c.name from public.customers c
     join public.buyers b on b.customer_id = c.id
     where b.id = 'b0000000-0000-0000-0000-0000000000b4' $$,
  array['Buyer Four'],
  'phoneless buyer row named after display name'
);

-- ---------------------------------------------------------------------------
-- Idempotency: re-running the shared function changes nothing.
-- ---------------------------------------------------------------------------
select public.link_or_create_customer_for_buyer('b0000000-0000-0000-0000-0000000000b1');
select results_eq(
  $$ select count(*)::int from public.customers
     where organization_id = 'c0000000-0000-0000-0000-0000000000cc' $$,
  array[4],
  're-run creates nothing (idempotent)'
);
select results_eq(
  $$ select customer_id from public.buyers where id = 'b0000000-0000-0000-0000-0000000000b1' $$,
  array['d0000000-0000-0000-0000-0000000000d1'::uuid],
  're-run keeps the original link'
);

-- ---------------------------------------------------------------------------
-- Grants: definer function is not callable by app roles (explicit, not inherited).
-- ---------------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'public.link_or_create_customer_for_buyer(uuid)', 'execute'),
  'anon cannot execute link_or_create_customer_for_buyer'
);
select ok(
  not has_function_privilege('authenticated', 'public.link_or_create_customer_for_buyer(uuid)', 'execute'),
  'authenticated cannot execute link_or_create_customer_for_buyer'
);

select * from finish();
rollback;
