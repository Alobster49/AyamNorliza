-- supabase/tests/rls/04_break_glass.sql
-- Break-glass events: anonymous cannot see them; RLS is enabled.

begin;

select plan(2);

select ok(
  (select relrowsecurity from pg_class where relname = 'break_glass_events' and relnamespace = 'public'::regnamespace) = true,
  'break_glass_events RLS is on'
);

select results_eq(
  $$ select count(*) from public.break_glass_events $$,
  $$ values (0::bigint) $$,
  'anon cannot see break_glass_events'
);

select * from finish();
rollback;
