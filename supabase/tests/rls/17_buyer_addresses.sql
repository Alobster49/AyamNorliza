-- supabase/tests/rls/17_buyer_addresses.sql
-- buyer_addresses RLS: buyers see only their own rows; anon sees nothing.
-- resolve_zone_for_postcode: match, no-match, malformed input.

begin;
select plan(7);

-- Seed: an org, two buyer auth users, a zone with a postcode range.
insert into auth.users (id) values
  ('a0000000-0000-0000-0000-00000000000a'), -- Buyer A
  ('b0000000-0000-0000-0000-00000000000b')  -- Buyer B
on conflict (id) do nothing;

insert into public.organizations (id, name, slug)
values ('c0000000-0000-0000-0000-00000000000c', 'AddrTest Org', 'addrtest-org')
on conflict (id) do nothing;

insert into public.buyers (id, organization_id, display_name)
values
  ('a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000c', 'Buyer A'),
  ('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-00000000000c', 'Buyer B')
on conflict (id) do nothing;

insert into public.buyer_addresses (id, buyer_id, address_line, postcode, state, area, is_default)
values ('d0000000-0000-0000-0000-00000000000d', 'a0000000-0000-0000-0000-00000000000a',
        '1 Jalan Test', '80000', 'Johor', 'Johor Bahru', true);

insert into public.delivery_zones (id, organization_id, name)
values ('e0000000-0000-0000-0000-00000000000e', 'c0000000-0000-0000-0000-00000000000c', 'Zone JB');

insert into public.zone_postcode_ranges (organization_id, zone_id, postcode_start, postcode_end)
values ('c0000000-0000-0000-0000-00000000000c', 'e0000000-0000-0000-0000-00000000000e', '80000', '81999');

-- Buyer A sees own row.
set local role authenticated;
set local "request.jwt.claim.sub" to 'a0000000-0000-0000-0000-00000000000a';
select results_eq(
  $$ select count(*)::int from public.buyer_addresses $$,
  array[1],
  'buyer sees own addresses'
);

-- Buyer B sees none of A's rows and cannot insert as A.
set local "request.jwt.claim.sub" to 'b0000000-0000-0000-0000-00000000000b';
select results_eq(
  $$ select count(*)::int from public.buyer_addresses $$,
  array[0],
  'other buyer sees nothing'
);
select throws_ok(
  $$ insert into public.buyer_addresses (buyer_id, address_line, postcode, state, area)
     values ('a0000000-0000-0000-0000-00000000000a', 'x', '80000', 'Johor', 'JB') $$,
  '42501',
  null,
  'cannot insert an address for another buyer'
);

-- Resolver: hit, miss, malformed.
select results_eq(
  $$ select public.resolve_zone_for_postcode('c0000000-0000-0000-0000-00000000000c', '80100') $$,
  array['e0000000-0000-0000-0000-00000000000e'::uuid],
  'postcode inside range resolves to the zone'
);
select results_eq(
  $$ select public.resolve_zone_for_postcode('c0000000-0000-0000-0000-00000000000c', '50000') $$,
  array[null::uuid],
  'uncovered postcode resolves to null'
);
select throws_ok(
  $$ select public.resolve_zone_for_postcode('c0000000-0000-0000-0000-00000000000c', '123') $$,
  'P0001',
  'invalid_postcode',
  'malformed postcode raises invalid_postcode'
);
reset role;

-- Anon: no grant at all.
set local role anon;
select throws_ok(
  $$ select count(*) from public.buyer_addresses $$,
  '42501',
  null,
  'anon cannot read buyer_addresses'
);
reset role;

select * from finish();
rollback;
