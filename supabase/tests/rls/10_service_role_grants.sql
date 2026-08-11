-- supabase/tests/rls/10_service_role_grants.sql
-- Table-GRANT regression test for `service_role`, fixed by
-- 20260811000002_service_role_grants.sql. `service_role` had no privileges
-- on any table in `public`, so every server-side admin path failed with
-- 42501 before RLS was consulted -- most importantly
-- `admin.insertAuditEvent`, which meant NO audit event was ever recorded
-- for role changes, deactivations, access reviews or break-glass.
--
-- These assertions exercise real writes through the service_role, the layer
-- that was silently broken.

begin;

select plan(4);

-- ---------------------------------------------------------------------------
-- Fixtures (inserted as postgres, which bypasses RLS/grants)
-- ---------------------------------------------------------------------------
insert into public.organizations (id, slug, name)
values ('c0000000-0000-0000-0000-00000000000a', 'service-role-grants-test-org', 'Service Role Grants Test Org')
on conflict (id) do nothing;

insert into auth.users (id) values
  ('c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, role, status)
values ('c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 'owner', 'active')
on conflict (organization_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- service_role can write the audit trail. This is the exact
-- `admin.insertAuditEvent` path (src/lib/supabase/admin.ts) that threw
-- "permission denied for table audit_log" before the grants migration.
-- ---------------------------------------------------------------------------
set local role service_role;

select lives_ok(
  $$ insert into public.audit_log (organization_id, actor_user_id, actor_role, event_type, entity_type, entity_id, source)
     values ('c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 'owner', 'identity.role_changed', 'organization_members', 'c0000000-0000-0000-0000-000000000001', 'web') $$,
  'service_role can insert an audit event (admin.insertAuditEvent path)'
);

select results_eq(
  $$ select event_type from public.audit_log where organization_id = 'c0000000-0000-0000-0000-00000000000a' $$,
  $$ values ('identity.role_changed'::text) $$,
  'service_role can read back the audit event it wrote'
);

select lives_ok(
  $$ insert into public.auth_security_events (user_id, organization_id, event_type)
     values ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000a', 'login_success') $$,
  'service_role can insert an auth security event (admin.insertAuthSecurityEvent path)'
);

select lives_ok(
  $$ select count(*) from public.invitations $$,
  'service_role can read invitations (admin-queries path)'
);

reset role;

select * from finish();
rollback;
