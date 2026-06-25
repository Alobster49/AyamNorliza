-- 20260624000005_id_access_schedules.sql
-- pg_cron schedules for the scheduled Edge Functions.
-- Requires the pg_cron and pg_net extensions.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The pg_cron job runs in the `postgres` role, which can invoke
-- `net.http_post`. Replace the URL/keys with your project values via
-- the `supabase secrets set` CLI (do not commit real keys).
-- When the settings are missing, the jobs become no-ops instead of erroring,
-- which keeps `db reset` and `db push` working without secrets configured.

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
      perform net.http_post(
        url := current_setting('app.functions_url') || '/access-review-reminder',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce(current_setting('app.functions_key', true), '')
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
      perform net.http_post(
        url := current_setting('app.functions_url') || '/temporary-access-expiry',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce(current_setting('app.functions_key', true), '')
        ),
        body := '{}'::jsonb
      );
    end $$;
  $cron$
);
