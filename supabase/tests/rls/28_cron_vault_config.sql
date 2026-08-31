-- supabase/tests/rls/28_cron_vault_config.sql
-- Coverage for 20260901000009_cron_config_via_vault.sql.
--
-- The three scheduled jobs used to read their URL and key from
-- `current_setting('app.*')`. That works locally but is undeployable on
-- hosted Supabase: the `postgres` role is refused with
-- `42501: permission denied to set parameter` at both database and role
-- scope, and with the reserved `app.settings.` prefix. Which is why the
-- schedules had never once fired on production -- `app.functions_url` was
-- unset and could not be set, so every job took its own no-op branch.
--
-- Vault is the hosted-supported store, so config moves there behind
-- `public.cron_config()`. Pinned here: the helper reads Vault and fails
-- soft, it is not reachable by ordinary API roles, and no job body is left
-- reading the old settings.

begin;

select plan(9);

-- ---------------------------------------------------------------------------
-- 1-3: the helper resolves Vault entries and returns null rather than
--      raising when one is absent, so a job can no-op cleanly.
-- ---------------------------------------------------------------------------
select is(
  public.cron_config('definitely_not_a_configured_name'),
  null,
  'returns null for a name that is not in Vault');

select lives_ok(
  $$ select vault.create_secret('https://example.functions.supabase.co', 'test_cron_url', 'pgTAP fixture') $$,
  'a config value can be stored in Vault');

select is(
  public.cron_config('test_cron_url'),
  'https://example.functions.supabase.co',
  'returns the stored value for a name that is in Vault');

-- ---------------------------------------------------------------------------
-- 4-6: the helper is not part of the public API surface. pg_cron runs as
--      postgres and needs no grant; anything reachable over PostgREST would
--      be a way to read secrets.
-- ---------------------------------------------------------------------------
select ok(
  not has_function_privilege('authenticated', 'public.cron_config(text)', 'execute'),
  'authenticated cannot execute cron_config');

select ok(
  not has_function_privilege('anon', 'public.cron_config(text)', 'execute'),
  'anon cannot execute cron_config');

-- Invoker rights, deliberately: a definer function owned by postgres would
-- hand Vault reads to anyone who ever gained execute on it.
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'cron_config'),
  false,
  'cron_config runs with invoker rights, not definer');

-- ---------------------------------------------------------------------------
-- 7-9: every scheduled job reads config through the helper, and none is
--      left on the setting that never worked in production.
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from cron.job where command like '%cron_config%'),
  3::bigint,
  'all three scheduled jobs read their config through cron_config');

select is(
  (select count(*) from cron.job where command like '%current_setting(''app.%'),
  0::bigint,
  'no scheduled job still reads the app.* settings that cannot be set on prod');

select is(
  (select count(*) from cron.job where command like '%x-cron-secret%'),
  3::bigint,
  'all three still send the shared secret header');

select * from finish();
rollback;
