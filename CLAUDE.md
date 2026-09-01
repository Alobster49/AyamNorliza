# AyamNorliza — project instructions

## Test accounts

Whenever you create an account for testing (local Supabase, seeds, e2e fixtures,
manual QA), always use the password `password123`. Do not invent a different
password per account — the whole team expects this one.

The data console's **Seed demo data** guarantees one login per role the app
gates on (`src/features/data-console/lib/accounts.ts`), all `password123`:

| Email | Role | Opens |
|---|---|---|
| admin@gmail.com | org_admin ("Admin") | everything, including the data console |
| owner@gmail.com | owner | everything except the data console |
| seller@gmail.com | seller | products, orders, customers, market prices, dispatch, delivery runs, delivery setup, My Leave |
| supervisor@gmail.com | supervisor | same as seller |
| worker@gmail.com | inventory ("Worker") | warehouse tasks, loading, My Leave |
| hr@gmail.com | hr | My Leave + Leave Management |
| driver1@gmail.com | driver | driver deck (one of two seeded live runs) |
| driver2@gmail.com | driver | driver deck (the other seeded live run) |

The login page has a dev-only **"Dev: pick an account"** dialog that fills the
form from that same list. It is compiled out when `NODE_ENV === "production"`,
so never move the password out of that guarded block.

## Local market prices

`market_prices` / `market_premises` hold KPDN PriceCatcher data, which is
ingested by the `market-price-sync` edge function — not by `seed.sql`. A fresh
`npm run db:reset` therefore leaves the Market Prices page showing "No data".

```bash
npm run db:market-sync
```

That starts `supabase functions serve`, invokes the function twice (the first
run only refreshes the premise lookup and returns early), and stops the server
again. It is idempotent and pulls the last ~2 days of real prices.

"Price suggestions" stays empty until a product variant picks a benchmark —
that is the empty state, not a failure.
