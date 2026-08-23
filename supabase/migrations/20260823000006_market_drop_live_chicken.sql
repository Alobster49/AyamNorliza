-- 20260823000006_market_drop_live_chicken.sql
-- Stop tracking PriceCatcher item 3 (AYAM HIDUP).
--
-- The item exists in KPDN's lookup_item.csv but has never carried a price
-- row: live birds trade at farm/wholesale, not at the retail premises
-- PriceCatcher surveys. Verified 0 rows nationwide across 2025-08, 2026-01,
-- 2026-07 and 2026-08. The sync no longer requests it (TRACKED_ITEM_CODES)
-- and the UI no longer offers it (MARKET_ITEMS); this migration realigns the
-- schema comments and clears any rows an earlier deployment may have stored.

delete from public.market_prices where item_code = 3;

update public.product_variants
   set market_item_code = null,
       market_margin_type = null,
       market_margin_value = null
 where market_item_code = 3;

comment on table public.market_prices is
  'Daily state-level aggregates of KPDN PriceCatcher retail prices for tracked chicken items (1=standard, 2=super). Item 3 (live) is never priced by KPDN and is not tracked.';

comment on column public.product_variants.market_item_code is
  'PriceCatcher item code this variant benchmarks against (1 or 2); null = not tracked.';
