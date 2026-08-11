-- 20260811000002_service_role_grants.sql
-- Forward-only privilege repair: `service_role` was never granted table
-- privileges in this project, so every server-side admin path failed with
-- 42501 "permission denied" before RLS was even consulted.
--
-- Symptom this fixes: `admin.insertAuditEvent` (src/lib/supabase/admin.ts)
-- throws on every audited action, so NO audit events were ever recorded --
-- role changes, deactivations, access reviews, break-glass. The same applied
-- to `insertAuthSecurityEvent`, the break-glass helpers, and the invitation
-- admin queries.
--
-- `service_role` is the trusted server-side key (it also bypasses RLS), so
-- restoring full table access here matches stock Supabase behaviour rather
-- than widening it. Default privileges are set as well so tables added by
-- later migrations are covered automatically.
--
-- Sibling repairs: 20260625000005 (authenticated, id_access tables) and
-- 20260811000001 (authenticated/anon, catalog tables).

begin;

grant usage on schema public to service_role;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;

commit;
