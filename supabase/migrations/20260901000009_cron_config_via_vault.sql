-- Move the scheduled jobs' config from `app.*` settings into Vault, so they
-- can actually run on hosted Supabase.
--
-- Every scheduled job since 20260624000005 has read its target URL from
-- `current_setting('app.functions_url', true)` and no-opped when unset. On
-- production that setting has always been unset, and cannot be set: the
-- `postgres` role is refused with
--
--     ERROR: 42501: permission denied to set parameter "app.functions_url"
--
-- at database scope, at role scope, and under the reserved `app.settings.`
-- prefix alike. (The `app.settings.jwt_exp` row that does exist was written
-- by Supabase's own provisioning.) So all three jobs have taken their no-op
-- branch on every tick since they were created: the daily access-review
-- reminders, temporary-access expiry warnings and KPDN price sync have never
-- once fired in production. The single successful prod ingest on record was
-- invoked by hand.
--
-- Vault is the store hosted Supabase does allow `postgres` to write and
-- read, and is its documented answer for exactly this case -- pg_cron
-- calling an Edge Function with a secret. Config moves there, behind a small
-- helper so the job bodies stay readable and the lookup is testable.
--
-- Two Vault entries are expected, per environment:
--
--   functions_url  https://<project-ref>.functions.supabase.co   (no trailing slash)
--   cron_secret    the same value as the functions' CRON_SECRET env var
--
-- Set them with:
--   select vault.create_secret('<value>', 'functions_url', 'Edge Functions base URL for pg_cron');
--   select vault.create_secret('<value>', 'cron_secret',  'Shared secret sent as x-cron-secret');
--
-- The no-op-when-unconfigured behaviour is kept, now keyed on Vault rather
-- than the settings: a job with no URL or no secret says so and skips,
-- rather than firing a request that would only earn a 401. That keeps
-- `db reset` and `db push` working on a machine with no Vault entries.
--
-- The `Authorization: Bearer app.functions_key` header is dropped. These
-- three functions are `verify_jwt = false`, so it authenticated nothing; the
-- `x-cron-secret` header added in 20260901000008 is what actually gates them,
-- and `app.functions_key` was never settable on prod either.

begin;

-- ---------------------------------------------------------------------------
-- Config lookup.
--
-- Invoker rights on purpose. A SECURITY DEFINER function owned by postgres
-- would turn any accidental EXECUTE grant into a Vault read for that role;
-- as an invoker function it can only ever see what the caller could already
-- see. pg_cron runs its jobs as postgres, which reads Vault directly, so no
-- grant is needed by anyone.
-- ---------------------------------------------------------------------------
create or replace function public.cron_config(p_name text)
returns text
language sql
stable
set search_path = public, vault, pg_temp
as $$
  select s.decrypted_secret
    from vault.decrypted_secrets s
   where s.name = p_name
   limit 1;
$$;

revoke all on function public.cron_config(text) from public, anon, authenticated;

comment on function public.cron_config(text) is
  'Reads a pg_cron configuration value from Vault. Returns null when absent so a job can no-op. Not granted to API roles.';

-- ---------------------------------------------------------------------------
-- Reschedule the three jobs onto it. `cron.schedule` upserts by name, so job
-- ids and history are preserved.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'access-review-reminder-daily',
  '0 9 * * *',
  $cron$
    do $$
    declare v_url text; v_secret text;
    begin
      v_url := public.cron_config('functions_url');
      v_secret := public.cron_config('cron_secret');
      if v_url is null or v_secret is null then
        raise notice 'functions_url or cron_secret missing from Vault; access-review-reminder cron is a no-op';
        return;
      end if;
      perform net.http_post(
        url := v_url || '/access-review-reminder',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', v_secret
        ),
        body := '{}'::jsonb
      );
    end $$;
  $cron$
);

select cron.schedule(
  'temporary-access-expiry-daily',
  '30 9 * * *',
  $cron$
    do $$
    declare v_url text; v_secret text;
    begin
      v_url := public.cron_config('functions_url');
      v_secret := public.cron_config('cron_secret');
      if v_url is null or v_secret is null then
        raise notice 'functions_url or cron_secret missing from Vault; temporary-access-expiry cron is a no-op';
        return;
      end if;
      perform net.http_post(
        url := v_url || '/temporary-access-expiry',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', v_secret
        ),
        body := '{}'::jsonb
      );
    end $$;
  $cron$
);

select cron.schedule(
  'market-price-sync-daily',
  '15 5 * * *',
  $cron$
    do $$
    declare v_url text; v_secret text;
    begin
      v_url := public.cron_config('functions_url');
      v_secret := public.cron_config('cron_secret');
      if v_url is null or v_secret is null then
        raise notice 'functions_url or cron_secret missing from Vault; market-price-sync cron is a no-op';
        return;
      end if;
      perform net.http_post(
        url := v_url || '/market-price-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', v_secret
        ),
        body := '{}'::jsonb
      );
    end $$;
  $cron$
);

commit;
