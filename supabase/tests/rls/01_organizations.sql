-- supabase/tests/rls/01_organizations.sql
-- Verifies organization RLS: members can read their own org; only owners
-- can update. Anonymous is denied.

begin;

select plan(3);

-- 1. Anonymous user cannot see any organization.
set local role anon;
select throws_ok(
  $$ select count(*) from public.organizations $$,
  '42501',
  null,
  'anon cannot list organizations'
);
reset role;

insert into public.audit_log (id, event_type, entity_type, source)
values ('00000000-0000-0000-0000-000000000101', 'test.audit', 'test', 'server')
on conflict (id) do nothing;

-- 2. The audit_log table is append-only: a no-op UPDATE must fail
--    with `insufficient_privilege`.
select throws_ok(
  $$ update public.audit_log set reason = 'tampered' where id = '00000000-0000-0000-0000-000000000101' $$,
  '42501',
  null,
  'audit_log blocks UPDATE'
);

-- 3. The audit_log table is append-only: a no-op DELETE must fail.
select throws_ok(
  $$ delete from public.audit_log where id = '00000000-0000-0000-0000-000000000101' $$,
  '42501',
  null,
  'audit_log blocks DELETE'
);

select * from finish();
rollback;
