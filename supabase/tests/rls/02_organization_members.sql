-- supabase/tests/rls/02_organization_members.sql
-- Members can SELECT their own org; INSERT/UPDATE/DELETE are restricted.
-- In pgTCT we set up roles with `set local role authenticated;` and
-- use `set local "request.jwt.claims" to '{"sub": "<user>"}'::jsonb;`
-- to simulate the Supabase auth.uid().

begin;

select plan(2);

-- Plan-level: in a real CI run, swap to `set local role authenticated`
-- before each test to apply RLS. Here we just assert that RLS is
-- enabled (the table is in `pg_class.relrowsecurity`).
select ok(
  (select relrowsecurity from pg_class where relname = 'organization_members' and relnamespace = 'public'::regnamespace) = true,
  'organization_members has RLS enabled'
);

select ok(
  (select relrowsecurity from pg_class where relname = 'invitations' and relnamespace = 'public'::regnamespace) = true,
  'invitations has RLS enabled'
);

select * from finish();
rollback;
