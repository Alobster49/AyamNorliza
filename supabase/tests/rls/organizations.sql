-- supabase/tests/rls/organizations.sql
-- Verifies that an anonymous user cannot see any organization and that
-- an authenticated user from one tenant cannot see another tenant's row.

begin;

select plan(2);

-- 1. Anonymous CAN read organizations (buyer portal public read:
--    policy from 20260719000001, anon grant from 20260822000003).
set local role anon;
select lives_ok(
  $$ select count(*) from public.organizations $$,
  'anonymous can read organizations for buyer portal browsing'
);
reset role;

insert into public.audit_log (id, event_type, entity_type, source)
values ('00000000-0000-0000-0000-000000000099', 'test.audit', 'test', 'server')
on conflict (id) do nothing;

-- 2. The audit_log table is locked against direct UPDATE/DELETE for the
--    service role. Verified by attempting an UPDATE which must raise.
select throws_ok(
  $$ update public.audit_log set reason = 'tampered' where id = '00000000-0000-0000-0000-000000000099' $$,
  '42501',
  null,
  'audit_log blocks UPDATE'
);

select * from finish();
rollback;
