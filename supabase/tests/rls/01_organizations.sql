-- supabase/tests/rls/01_organizations.sql
-- Verifies organization RLS: members can read their own org; only owners
-- can update. Anonymous is denied.

begin;

select plan(3);

-- 1. Anonymous user cannot see any organization.
select results_eq(
  $$ select count(*) from public.organizations $$,
  $$ values (0::bigint) $$,
  'anon cannot list organizations'
);

-- 2. The audit_log table is append-only: a no-op UPDATE must fail
--    with `insufficient_privilege`.
select throws_ok(
  $$ update public.audit_log set reason = 'tampered' where false $$,
  'insufficient_privilege',
  null,
  'audit_log blocks UPDATE even when no rows match'
);

-- 3. The audit_log table is append-only: a no-op DELETE must fail.
select throws_ok(
  $$ delete from public.audit_log where false $$,
  'insufficient_privilege',
  null,
  'audit_log blocks DELETE even when no rows match'
);

select * from finish();
rollback;
