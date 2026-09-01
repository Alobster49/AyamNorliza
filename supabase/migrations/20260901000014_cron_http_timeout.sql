-- Raise the pg_net client timeout on the two long-running scheduled jobs, so
-- their failures are legible.
--
-- 20260901000009 got the jobs genuinely calling their Edge Functions. The
-- first real run, 2026-09-01:
--
--   net._http_response id 2  market-price-sync       05:15  status null,
--     'Timeout of 5000 ms reached. Total time: 5000.821 ms
--      (DNS 80.439 ms, TCP/SSL handshake 44.380 ms, HTTP 4875.160 ms)'
--   net._http_response id 3  access-review-reminder  09:00  status null,
--     'Timeout of 5000 ms reached. Total time: 5000.709 ms'
--   net._http_response id 4  temporary-access-expiry 09:30  status 200,
--     '{"notified":0,"memberships":0,"break_glass":0}'
--
-- The 5000 ms default on `net.http_post` was not the bug, and this migration
-- is not the fix. Re-running market-price-sync by hand at 60000 ms returned
--
--   status 546  {"code":"WORKER_RESOURCE_LIMIT","message":"Function failed
--                due to not having enough compute resources"}
--
-- -- the worker is killed by the edge runtime well before any network budget
-- matters. The short timeout only hid that behind a null status_code and an
-- error string about DNS and handshake timings, which is the wrong place to
-- look. 60s buys enough room for the real status code to come back.
--
-- Note what a pg_net timeout does and does not do: it abandons the response,
-- it does not cancel the request. A job that times out keeps running
-- server-side to whatever end it reaches, so its outcome becomes
-- unobservable -- which is the actual cost being paid down here. For
-- market-price-sync we can still check the durable trace
-- (`public.market_prices` was stuck at 2026-08-23); access-review-reminder
-- leaves none when it has nothing to notify, so `net._http_response` is the
-- only evidence it ever produces.
--
-- temporary-access-expiry keeps the default: it answered in well under 5s
-- and waits on nothing external, so widening it would only delay a future
-- regression's discovery.
--
-- `cron.schedule` upserts by name, so job ids and run history are preserved.
-- Bodies are otherwise identical to 20260901000009.

begin;

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
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
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
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );
    end $$;
  $cron$
);

commit;
