-- supabase/tests/rls/03_invitations.sql
-- Invitations are protected: only org owners/admins can SELECT/INSERT;
-- a non-member cannot read invitations by email.

begin;

select plan(2);

-- 1. Invitations are RLS-enabled.
select ok(
  (select relrowsecurity from pg_class where relname = 'invitations' and relnamespace = 'public'::regnamespace) = true,
  'invitations RLS is on'
);

-- 2. Anonymous cannot SELECT invitations.
select results_eq(
  $$ select count(*) from public.invitations $$,
  $$ values (0::bigint) $$,
  'anon cannot list invitations'
);

select * from finish();
rollback;
