-- supabase/tests/rls/06_audit_log.sql
-- audit_log: RLS enabled and no INSERT/UPDATE/DELETE policy for the
-- `authenticated` role. The only insert path is the SECURITY DEFINER
-- function `record_audit_event`.

begin;

select plan(3);

select ok(
  (select relrowsecurity from pg_class where relname = 'audit_log' and relnamespace = 'public'::regnamespace) = true,
  'audit_log RLS is on'
);

insert into public.audit_log (id, event_type, entity_type, source)
values ('00000000-0000-0000-0000-000000000106', 'test.audit', 'test', 'server')
on conflict (id) do nothing;

-- An UPDATE on audit_log must be blocked by the BEFORE UPDATE trigger.
select throws_ok(
  $$ update public.audit_log set reason = 'tampered' where id = '00000000-0000-0000-0000-000000000106' $$,
  '42501',
  null,
  'audit_log denies UPDATE'
);

-- A DELETE on audit_log must be blocked by the BEFORE DELETE trigger.
select throws_ok(
  $$ delete from public.audit_log where id = '00000000-0000-0000-0000-000000000106' $$,
  '42501',
  null,
  'audit_log denies DELETE'
);

select * from finish();
rollback;
