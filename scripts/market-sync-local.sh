#!/usr/bin/env bash
# Populate the local market_prices table by running the real market-price-sync
# edge function against the local stack.
#
# `supabase db reset` wipes market_premises / market_prices, and nothing in
# seed.sql refills them (the data is KPDN's, not ours), so the Market Prices
# page renders "No data" on every fresh local database until this runs.
#
# The function is invoked twice on purpose: a run that refreshes the premise
# lookup returns early without ingesting prices, so the first call rebuilds
# premise_code -> state and the second ingests the price rows.
set -euo pipefail

CRON_SECRET="${CRON_SECRET:-local-dev-cron-secret}"
FUNCTIONS_URL="${FUNCTIONS_URL:-http://127.0.0.1:54321/functions/v1}"
ENV_FILE="$(mktemp -t market-sync-env)"
trap 'rm -f "$ENV_FILE"' EXIT

printf 'CRON_SECRET=%s\n' "$CRON_SECRET" > "$ENV_FILE"

npx supabase functions serve --env-file "$ENV_FILE" > /tmp/market-sync-serve.log 2>&1 &
SERVE_PID=$!
trap 'kill "$SERVE_PID" 2>/dev/null || true; rm -f "$ENV_FILE"' EXIT

for _ in $(seq 1 30); do
  grep -q 'market-price-sync' /tmp/market-sync-serve.log && break
  sleep 1
done

for run in 1 2; do
  echo "run $run:"
  curl -sS -X POST "$FUNCTIONS_URL/market-price-sync" \
    -H "x-cron-secret: $CRON_SECRET" \
    -H "Content-Type: application/json" \
    -d '{}'
  echo
done
