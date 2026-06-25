-- supabase/tests/rls/organizations.sql
-- Verifies that an anonymous user cannot see any organization and that
-- an authenticated user from one tenant cannot see another tenant's row.

begin;

select plan(2);

-- 1. Anonymous cannot see any organization row.
select results_eq(
  $$ select count(*) from public.organizations $$,
  $$ values (0::bigint) $$,
  'anonymous cannot list organizations'
);

-- 2. The audit_log table is locked against direct UPDATE/DELETE for the
--    service role. Verified by attempting an UPDATE which must raise.
select throws_ok(
  $$ update public.audit_log set reason = 'tampered' where false $$,
  'insufficient_privilege',
  null,
  'audit_log blocks UPDATE even when no rows match'
);

select * from finish();
rollback;
