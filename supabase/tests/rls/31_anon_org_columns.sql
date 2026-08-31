-- supabase/tests/rls/31_anon_org_columns.sql
-- Coverage for 20260901000013_narrow_anon_org_read_and_index.sql.
--
-- `organizations` is deliberately readable by anonymous visitors -- the buyer
-- portal's shop page needs the org's name and slug before anyone signs in.
-- What was not deliberate is that 20260828000001 added the invoice letterhead
-- to the same table, so `registration_no`, `address`, `phone` and `email`
-- became world-readable too, along with the internal created_by/updated_by
-- ids. The row stays public; the columns do not.

begin;

select plan(6);

insert into public.organizations (id, slug, name, region, registration_no, address, phone, email)
values ('fa000000-0000-0000-0000-0000000000cc', 'anon-columns-org', 'Anon Columns Org', 'Johor',
        'SSM-123456', '1 Jalan Rahsia', '0123456789', 'private@example.com')
on conflict (id) do nothing;

set local role anon;

-- ---------------------------------------------------------------------------
-- 1-2: the public identity columns still work, or the shop page breaks.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select id, slug, name, region from public.organizations $$,
  'anon can still read the public identity columns the buyer portal needs');

select is(
  (select name from public.organizations where slug = 'anon-columns-org'),
  'Anon Columns Org',
  'and gets the actual row back');

-- ---------------------------------------------------------------------------
-- 3-6: the letterhead and internal bookkeeping are not public.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select registration_no from public.organizations $$,
  '42501', null, 'anon cannot read the SSM registration number');

select throws_ok(
  $$ select address, phone, email from public.organizations $$,
  '42501', null, 'anon cannot read the business address, phone or email');

select throws_ok(
  $$ select created_by from public.organizations $$,
  '42501', null, 'anon cannot read internal user ids');

-- A bare `select *` is the shape a curious visitor would actually try.
select throws_ok(
  $$ select * from public.organizations $$,
  '42501', null, 'select * is refused rather than quietly returning everything');

reset role;

select * from finish();
rollback;
