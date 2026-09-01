-- Byte cursor for incremental PriceCatcher ingest.
--
-- market-price-sync re-parsed the whole month file on every run. That is
-- O(month) work repeated daily, and it outgrew the edge runtime: on
-- 2026-09-01 the function returned
--
--   status 546  {"code":"WORKER_RESOURCE_LIMIT","message":"Function failed
--                due to not having enough compute resources"}
--
-- both from cron and from a hand-run at a 60s timeout. Measured that day:
-- pricecatcher_2026-08.csv is 50,122,871 bytes (~1.5M rows) against
-- pricecatcher_2026-09.csv at 899,668 bytes. Day 1-3 runs fetch both, so the
-- boundary is the worst case -- but the current-month file alone crosses the
-- same line in the last third of any month. The one successful hand-run, on
-- 2026-08-23, was already reading ~37 MB.
--
-- KPDN appends to the month file in date order; a range read of the last
-- 100 KB of the August file returned nothing but 2026-08-30 rows. So the
-- function can ask for `Range: bytes=<cursor>-` and parse only the day's
-- delta -- roughly 1.6 MB, flat, wherever we are in the month.
--
-- `bytes_read` is always a line boundary. The function advances it to the
-- first byte of the newest date it saw, not to the end of what it read, so a
-- day still being appended is re-read and re-aggregated next run rather than
-- being frozen half-counted in `premise_count`. Upserts are idempotent, so
-- the overlap costs one day's bytes and nothing else.
--
-- No history backfill: on a month with no cursor the function starts from a
-- tail offset rather than byte 0, since starting at 0 is exactly the 50 MB
-- read that kills the worker. market_prices keeps whatever it already holds.

create table if not exists public.market_sync_cursor (
  month text primary key check (month ~ '^\d{4}-\d{2}$'),
  bytes_read bigint not null check (bytes_read >= 0),
  file_size bigint not null check (file_size >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.market_sync_cursor is
  'Per-month byte offset into KPDN pricecatcher_YYYY-MM.csv, so market-price-sync reads only newly appended rows. Written by the edge function under the service role; not readable by API roles.';

comment on column public.market_sync_cursor.bytes_read is
  'Offset of the first byte not yet ingested. Always a line boundary, and held back to the start of the newest date seen so a partially appended day is re-read.';

comment on column public.market_sync_cursor.file_size is
  'Content-Length observed at that read. A later size below this one means KPDN rewrote rather than appended, and the cursor resets.';

-- Service-role only: the edge function is the sole reader and writer, and
-- nothing in the app surfaces sync bookkeeping. RLS on with no policies
-- denies every API role outright; the service role bypasses RLS. No grants
-- to `authenticated` on purpose -- see the grants note in the market tables
-- of 20260823000001.
alter table public.market_sync_cursor enable row level security;
