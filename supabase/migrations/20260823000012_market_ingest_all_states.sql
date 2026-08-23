-- 20260823000007_market_ingest_all_states.sql
-- market_settings.states is now a display preference, not an ingest gate.
--
-- The sync used to store only the states some org had configured, so every
-- other state in the picker rendered "Tiada data" forever. It now ingests
-- all 16 states: the month CSV is downloaded whole regardless, and the extra
-- rows cost ~32 a day (16 states x 2 items).

comment on table public.market_settings is
  'Which PriceCatcher state an organization''s market price card displays. Display preference only -- the sync ingests every state. v1 UI writes a single-element array.';

comment on table public.market_prices is
  'Daily state-level aggregates of KPDN PriceCatcher retail prices for tracked chicken items (1=standard, 2=super), for all Malaysian states. Item 3 (live) is never priced by KPDN and is not tracked.';
