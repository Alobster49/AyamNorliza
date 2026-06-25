-- supabase/tests/rls/05_support_sessions.sql
-- Support sessions are RLS-protected; anon sees nothing.

begin;

select plan(2);

select ok(
  (select relrowsecurity from pg_class where relname = 'support_sessions' and relnamespace = 'public'::regnamespace) = true,
  'support_sessions RLS is on'
);

select results_eq(
  $$ select count(*) from public.support_sessions $$,
  $$ values (0::bigint) $$,
  'anon cannot list support_sessions'
);

select * from finish();
rollback;
