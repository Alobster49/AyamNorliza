-- 20260823000002_market_price_schedule.sql
-- Daily pg_cron trigger for the market-price-sync Edge Function.
-- 05:15 UTC = 13:15 MYT, after KPDN's ~12:00 MYT PriceCatcher upload.
-- Same no-op-without-settings pattern as 20260624000005_id_access_schedules.sql.

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
      perform net.http_post(
        url := current_setting('app.functions_url') || '/market-price-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce(current_setting('app.functions_key', true), '')
        ),
        body := '{}'::jsonb
      );
    end $$;
  $cron$
);
