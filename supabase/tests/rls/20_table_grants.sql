-- supabase/tests/rls/20_table_grants.sql
-- Coverage for 20260823000005_lock_down_anon_grants.sql.
--
-- RLS is the thing that filters rows, but the table grant is what decides
-- whether a role gets to ask at all. Nothing in this project asserted the
-- grants, so local and the hosted project drifted apart without anyone
-- noticing. These tests pin the privilege set down so the next drift fails
-- here instead of in production.

begin;

select plan(9);

-- ---------------------------------------------------------------------------
-- anon: reads the storefront, writes nothing.
-- ---------------------------------------------------------------------------
select is_empty(
  $$ select table_name || ':' || privilege_type
     from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'anon'
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE') $$,
  'anon holds no write privilege on any public table'
);

select is_empty(
  $$ select table_name
     from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'anon'
       and privilege_type = 'TRUNCATE' $$,
  'anon cannot truncate -- truncate ignores RLS entirely'
);

select set_eq(
  $$ select table_name::text
     from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'anon'
       and privilege_type = 'SELECT' $$,
  array['categories', 'delivery_zones', 'organizations', 'product_variants', 'products'],
  'anon reads exactly the five buyer-portal storefront tables'
);

-- ---------------------------------------------------------------------------
-- authenticated: the pipeline tables are RPC-only, so no direct writes.
-- ---------------------------------------------------------------------------
select is_empty(
  $$ select table_name || ':' || privilege_type
     from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'authenticated'
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
       and table_name in ('orders', 'order_items', 'order_tasks', 'order_weight_log',
                          'delivery_runs', 'delivery_attempts', 'run_stop_events') $$,
  'the order and dispatch tables are written only through security definer RPCs'
);

select is_empty(
  $$ select privilege_type
     from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'authenticated'
       and table_name = 'audit_log'
       and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE') $$,
  'the audit log is append-only to authenticated -- no update, delete or truncate'
);

select is_empty(
  $$ select table_name
     from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'authenticated'
       and privilege_type = 'TRUNCATE' $$,
  'authenticated cannot truncate either'
);

select ok(
  has_table_privilege('authenticated', 'public.orders', 'SELECT'),
  'authenticated can still read orders (RLS narrows it to their own org)'
);

-- ---------------------------------------------------------------------------
-- service_role keeps everything: it is the trusted server-side key and
-- 20260811000002 exists precisely because it once did not.
-- ---------------------------------------------------------------------------
select is_empty(
  $$ select c.relname
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and not has_table_privilege('service_role', c.oid, 'INSERT') $$,
  'service_role still writes every public table'
);

-- ---------------------------------------------------------------------------
-- Future tables must not inherit DML by default -- that was the actual bug.
--
-- Scoped to the default privileges owned by `postgres`, the role migrations
-- run as, because those are the ones that govern a table a migration
-- creates. Schema public also carries a `supabase_admin`-owned entry that
-- still grants anon everything; it applies only to tables supabase_admin
-- itself creates, and it is not ours to change.
-- ---------------------------------------------------------------------------
select is_empty(
  $$ select entry::text
     from pg_default_acl d
     join pg_namespace n on n.oid = d.defaclnamespace
     cross join lateral unnest(d.defaclacl) as entry
     where n.nspname = 'public' and d.defaclobjtype = 'r'
       and d.defaclrole = 'postgres'::regrole
       and entry::text ~ '^(anon|authenticated)=[a-zA-Z]*[arwd]' $$,
  'schema public hands new tables no anon/authenticated DML by default'
);

select * from finish();
rollback;
