-- supabase/tests/rls/18_market_prices.sql
-- market_prices / market_premises: readable by authenticated, not writable.
-- market_settings: org members only. get_market_suggestions: computes
-- suggested price from seeded market data, scoped to the caller's own org
-- membership (not just product_variants RLS, which is not org-scoped for
-- available variants).

begin;
select plan(9);

-- Seed: org, seller user, product + mapped variant, market rows.
-- 000005 is authenticated but NOT a member of the test org — used to prove
-- get_market_suggestions cannot be used to read another org's suggestions.
insert into auth.users (id) values
  ('10000000-0000-0000-0000-000000000001'), -- seller (org member)
  ('10000000-0000-0000-0000-000000000005')  -- outsider, no membership
on conflict (id) do nothing;

insert into public.organizations (id, name, slug)
values ('20000000-0000-0000-0000-000000000002', 'MarketTest Org', 'markettest-org')
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, role, status)
values ('20000000-0000-0000-0000-000000000002',
        '10000000-0000-0000-0000-000000000001', 'seller', 'active')
on conflict do nothing;

insert into public.categories (id, organization_id, name)
values ('30000000-0000-0000-0000-000000000009',
        '20000000-0000-0000-0000-000000000002', 'Ayam');

insert into public.products (id, organization_id, category_id, name)
values ('30000000-0000-0000-0000-000000000003',
        '20000000-0000-0000-0000-000000000002',
        '30000000-0000-0000-0000-000000000009', 'Ayam Bersih');

insert into public.product_variants
  (id, organization_id, product_id, name,
   market_item_code, market_margin_type, market_margin_value)
values ('40000000-0000-0000-0000-000000000004',
        '20000000-0000-0000-0000-000000000002',
        '30000000-0000-0000-0000-000000000003',
        'Standard', 1, 'rm', 1.00);

-- Seven days of Selangor medians 9.00..9.60 → median 9.30, +1.00 margin = 10.30.
insert into public.market_prices
  (price_date, item_code, state, median_price, avg_price, min_price, max_price, premise_count)
select current_date - offs, 1, 'Selangor',
       9.00 + offs * 0.10, 9.00 + offs * 0.10, 8.00, 11.00, 50
from generate_series(0, 6) as offs;

-- 1. anon cannot read market_prices.
set local role anon;
select throws_ok(
  $$ select count(*) from public.market_prices $$,
  '42501', null, 'anon cannot read market_prices');
reset role;

-- 2. authenticated can read market_prices.
set local role authenticated;
set local "request.jwt.claim.sub" to '10000000-0000-0000-0000-000000000001';
select results_eq(
  $$ select count(*)::int from public.market_prices $$,
  array[7], 'authenticated reads market_prices');

-- 3. authenticated cannot write market_prices.
select throws_ok(
  $$ insert into public.market_prices
     (price_date, item_code, state, median_price, avg_price, min_price, max_price, premise_count)
     values (current_date, 1, 'Selangor', 1, 1, 1, 1, 1) $$,
  '42501', null, 'authenticated cannot insert market_prices');

-- 4. authenticated can read market_premises (empty is fine).
select lives_ok(
  $$ select count(*) from public.market_premises $$,
  'authenticated reads market_premises');

-- 5. org member can upsert own org market_settings.
select lives_ok(
  $$ insert into public.market_settings (org_id, states)
     values ('20000000-0000-0000-0000-000000000002', array['Selangor'])
     on conflict (org_id) do update set states = excluded.states $$,
  'member upserts own market_settings');

-- 6. member cannot insert settings for another org.
select throws_ok(
  $$ insert into public.market_settings (org_id, states)
     values ('99999999-0000-0000-0000-000000000009', array['Johor']) $$,
  null, null, 'cannot insert settings for foreign org');

-- 7. suggestion math: median 9.30 + RM1.00 margin = 10.30, not stale.
select results_eq(
  $$ select suggested_price::numeric(10,2), stale
     from public.get_market_suggestions('20000000-0000-0000-0000-000000000002') $$,
  $$ values (10.30::numeric(10,2), false) $$,
  'suggested price = 7-day median + rm margin');

-- 8. pct margin: 9.30 * 1.10 = 10.23.
reset role;
update public.product_variants
set market_margin_type = 'pct', market_margin_value = 10
where id = '40000000-0000-0000-0000-000000000004';
set local role authenticated;
set local "request.jwt.claim.sub" to '10000000-0000-0000-0000-000000000001';
select results_eq(
  $$ select suggested_price::numeric(10,2)
     from public.get_market_suggestions('20000000-0000-0000-0000-000000000002') $$,
  $$ values (10.23::numeric(10,2)) $$,
  'pct margin applied');

-- 9. an authenticated user who is not a member of the org gets zero rows,
-- even though product_variants_select_public would let them read the
-- underlying variant directly.
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" to '10000000-0000-0000-0000-000000000005';
select results_eq(
  $$ select count(*)::int
     from public.get_market_suggestions('20000000-0000-0000-0000-000000000002') $$,
  array[0], 'non-member gets zero rows from get_market_suggestions');

select * from finish();
rollback;
