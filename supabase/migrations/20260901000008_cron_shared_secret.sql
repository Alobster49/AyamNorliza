-- Send a shared secret with every scheduled Edge Function invocation.
--
-- access-review-reminder, temporary-access-expiry and market-price-sync run
-- `verify_jwt = false` (pg_cron calls them server-to-server, not on behalf of
-- a signed-in user), and until now nothing else authenticated the caller
-- either. They are the only part of this system reachable from the open
-- internet, and each holds a service-role client: anyone who guessed the
-- function URL could send real email to real org members through the Resend
-- quota, or drive the KPDN ingest, once per request, unthrottled.
--
-- The functions now require an `x-cron-secret` header matching their own
-- CRON_SECRET env var (supabase/functions/_shared/cron-auth.ts). This
-- reschedules the three jobs to send it, read from the `app.cron_secret`
-- database setting.
--
-- `cron.schedule` upserts by job name, so re-running this is safe and the
-- job ids are preserved.
--
-- Same no-op-when-unconfigured pattern as the original schedules, extended to
-- the new setting: a job with no secret to send would only earn a 401, so it
-- skips the call and says why. That keeps `db reset` and `db push` working on
-- a machine with no secrets configured.
--
-- ROLLOUT ORDER MATTERS. Set the secret on both sides before deploying the
-- new function code, or the daily jobs start failing silently:
--
--   1. alter database postgres set app.cron_secret = '<value>';
--   2. supabase secrets set CRON_SECRET='<same value>'
--   3. supabase functions deploy access-review-reminder temporary-access-expiry market-price-sync
--
-- Between 1 and 3 the old deployed functions simply ignore the extra header.

begin;

select cron.schedule(
  'access-review-reminder-daily',
  '0 9 * * *',
  $cron$
    do $$
    begin
      if coalesce(current_setting('app.functions_url', true), '') = '' then
        raise notice 'app.functions_url not set; access-review-reminder cron is a no-op';
        return;
      end if;
      if coalesce(current_setting('app.cron_secret', true), '') = '' then
        raise notice 'app.cron_secret not set; access-review-reminder cron is a no-op';
        return;
      end if;
      perform net.http_post(
        url := current_setting('app.functions_url') || '/access-review-reminder',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce(current_setting('app.functions_key', true), ''),
          'x-cron-secret', current_setting('app.cron_secret')
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
    begin
      if coalesce(current_setting('app.functions_url', true), '') = '' then
        raise notice 'app.functions_url not set; temporary-access-expiry cron is a no-op';
        return;
      end if;
      if coalesce(current_setting('app.cron_secret', true), '') = '' then
        raise notice 'app.cron_secret not set; temporary-access-expiry cron is a no-op';
        return;
      end if;
      perform net.http_post(
        url := current_setting('app.functions_url') || '/temporary-access-expiry',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce(current_setting('app.functions_key', true), ''),
          'x-cron-secret', current_setting('app.cron_secret')
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
    begin
      if coalesce(current_setting('app.functions_url', true), '') = '' then
        raise notice 'app.functions_url not set; market-price-sync cron is a no-op';
        return;
      end if;
      if coalesce(current_setting('app.cron_secret', true), '') = '' then
        raise notice 'app.cron_secret not set; market-price-sync cron is a no-op';
        return;
      end if;
      perform net.http_post(
        url := current_setting('app.functions_url') || '/market-price-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce(current_setting('app.functions_key', true), ''),
          'x-cron-secret', current_setting('app.cron_secret')
        ),
        body := '{}'::jsonb
      );
    end $$;
  $cron$
);

commit;
