-- 20260823000005_lock_down_anon_grants.sql
-- Assert table privileges in a migration instead of inheriting whatever the
-- environment happens to hand out.
--
-- No migration in this project has ever revoked anything from `anon` or
-- `authenticated`. 20260625000005, 20260811000001 and 20260811000002 each
-- granted more to somebody; nothing ever took anything away. That looked
-- fine locally only because the CLI's local stack narrows the schema-public
-- default privileges to `Dxtm` (truncate/references/trigger/maintain), so a
-- newly created table arrived with no DML for anon.
--
-- A hosted project carries stock Supabase defaults -- `arwdDxtm` -- so the
-- same migrations produced a very different result there. Discovered by
-- diffing prod after the 2026-08-23 dispatch release: `anon` held SELECT,
-- INSERT, UPDATE *and* DELETE on all 37 public tables, audit_log and
-- profiles included, and the eleven tables that release created inherited
-- the same thing.
--
-- Nothing was exposed: RLS is enabled on every table and PostgREST requests
-- as anon are still filtered to nothing. But the grant is the only thing
-- standing between "one permissive `to public` policy" and a world-writable
-- table, and DELETE on audit_log defeats the point of an audit log.
--
-- So: strip anon and authenticated back to nothing, then re-grant exactly
-- the set the app is tested against, and fix the default privileges so
-- tables added later do not quietly inherit DML again.
--
-- NOTE for later migrations: after this runs, a new table starts with *no*
-- anon/authenticated privileges. Grant them explicitly in the migration
-- that creates the table -- the local test suite will 42501 if you forget,
-- which is the point.

begin;

-- ---------------------------------------------------------------------------
-- 1. Stop future tables inheriting DML.
-- ---------------------------------------------------------------------------
-- These run as `postgres`, so they rewrite the default privileges that
-- govern tables a migration creates. Schema public also carries a
-- `supabase_admin`-owned entry granting anon everything -- that one applies
-- only to tables supabase_admin itself creates and is not ours to touch, so
-- \ddp will still show it afterwards. That is expected, not a leftover.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on tables from authenticated;

-- Sequences are left alone: identity columns need the sequence privilege to
-- insert, and no table is reachable by a role that lacks INSERT on it anyway.

-- ---------------------------------------------------------------------------
-- 2. Strip both roles back to nothing.
--
-- Also clears the TRUNCATE / REFERENCES / TRIGGER / MAINTAIN bits, which
-- both roles held on every table. TRUNCATE is not reachable through
-- PostgREST, but it is not filtered by RLS either, so there is no reason
-- for an untrusted role to keep it.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

-- ---------------------------------------------------------------------------
-- 3. Re-grant the tested set.
--
-- anon reads the buyer-portal storefront and nothing else. Everything an
-- authenticated user writes through the order and dispatch pipeline goes
-- via a security definer RPC, which is why orders, order_items, order_tasks,
-- order_weight_log, delivery_runs, delivery_attempts and run_stop_events are
-- SELECT-only here.
-- ---------------------------------------------------------------------------
grant select on public.categories       to anon;
grant select on public.delivery_zones   to anon;
grant select on public.organizations    to anon;
grant select on public.product_variants to anon;
grant select on public.products         to anon;

grant select on public.audit_log            to authenticated;
grant select on public.auth_security_events to authenticated;
grant select on public.delivery_attempts    to authenticated;
grant select on public.delivery_runs        to authenticated;
grant select on public.market_premises      to authenticated;
grant select on public.market_prices        to authenticated;
grant select on public.order_items          to authenticated;
grant select on public.order_tasks          to authenticated;
grant select on public.order_weight_log     to authenticated;
grant select on public.orders               to authenticated;
grant select on public.run_stop_events      to authenticated;

grant select, insert, update on public.buyers          to authenticated;
grant select, insert, update on public.market_settings to authenticated;

grant select, insert, update, delete on public.access_review_items       to authenticated;
grant select, insert, update, delete on public.access_reviews            to authenticated;
grant select, insert, update, delete on public.bays                      to authenticated;
grant select, insert, update, delete on public.break_glass_events        to authenticated;
grant select, insert, update, delete on public.buyer_addresses           to authenticated;
grant select, insert, update, delete on public.categories                to authenticated;
grant select, insert, update, delete on public.customers                 to authenticated;
grant select, insert, update, delete on public.delivery_slots            to authenticated;
grant select, insert, update, delete on public.delivery_zones            to authenticated;
grant select, insert, update, delete on public.facilities                to authenticated;
grant select, insert, update, delete on public.invitations               to authenticated;
grant select, insert, update, delete on public.member_scopes             to authenticated;
grant select, insert, update, delete on public.organization_members      to authenticated;
grant select, insert, update, delete on public.organizations             to authenticated;
grant select, insert, update, delete on public.product_variants          to authenticated;
grant select, insert, update, delete on public.products                  to authenticated;
grant select, insert, update, delete on public.profiles                  to authenticated;
grant select, insert, update, delete on public.role_capability_overrides to authenticated;
grant select, insert, update, delete on public.schedule_blocks           to authenticated;
grant select, insert, update, delete on public.support_sessions          to authenticated;
grant select, insert, update, delete on public.truck_zones               to authenticated;
grant select, insert, update, delete on public.trucks                    to authenticated;
grant select, insert, update, delete on public.zone_postcode_ranges      to authenticated;

-- ---------------------------------------------------------------------------
-- 4. public.events -- prod only, deliberately anon-writable.
--
-- This table exists on the hosted project but in no migration: an analytics
-- funnel (session_id, step, props) with an `anon_insert_events` policy whose
-- check is `true`. The sweep above would have silently switched off that
-- write path, so put it back. It stays conditional because the table does
-- not exist locally.
--
-- It should be brought into a migration or dropped; leaving a hand-made
-- table in the schema is how this whole divergence started.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.events') is not null then
    execute 'grant insert on public.events to anon';
    execute 'grant select, insert on public.events to authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Fail the migration if anon can still write anywhere unexpected.
--
-- The divergence above went unnoticed for months because nothing asserted
-- the privilege set. This runs on every fresh database, so the next time
-- something hands anon a write it stops here instead of in production.
-- ---------------------------------------------------------------------------
do $$
declare
  v_unexpected text;
begin
  select string_agg(distinct table_name, ', ' order by table_name)
    into v_unexpected
  from information_schema.role_table_grants
  where table_schema = 'public'
    and grantee = 'anon'
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
    and table_name <> 'events';

  if v_unexpected is not null then
    raise exception 'anon still holds write privileges on: %', v_unexpected;
  end if;
end $$;

commit;
