-- supabase/tests/rls/00_template.sql
-- Copy this template for each table's RLS test. The test uses
-- pgTCT (postgres-tap) helpers that ship with `supabase test db`.

begin;

-- Plan the number of tests so pgTCT reports a clear summary.
select plan(1);

-- Run a query as an anonymous user, expect a permission denial.
-- (organizations is deliberately anon-readable for the buyer portal since
-- 20260822000003, so the example uses organization_members instead.)
set local role anon;
select throws_ok(
  $$ select count(*) from public.organization_members $$,
  '42501',
  null,
  'anonymous cannot list organization members'
);
reset role;

select * from finish();
rollback;
