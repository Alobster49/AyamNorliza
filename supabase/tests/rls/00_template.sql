-- supabase/tests/rls/00_template.sql
-- Copy this template for each table's RLS test. The test uses
-- pgTCT (postgres-tap) helpers that ship with `supabase test db`.

begin;

-- Plan the number of tests so pgTCT reports a clear summary.
select plan(1);

-- Run a query as an anonymous user, expect a permission denial.
set local role anon;
select throws_ok(
  $$ select count(*) from public.organizations $$,
  '42501',
  null,
  'anonymous cannot list organizations'
);
reset role;

select * from finish();
rollback;
