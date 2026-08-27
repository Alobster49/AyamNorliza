# AyamNorliza — project instructions

## Test accounts

Whenever you create an account for testing (local Supabase, seeds, e2e fixtures,
manual QA), always use the password `password123`. Do not invent a different
password per account — the whole team expects this one.

The data console's **Seed demo data** guarantees one login per role the app
gates on (`src/features/data-console/lib/accounts.ts`), all `password123`:

| Email | Role | Opens |
|---|---|---|
| owner@gmail.com | owner | everything, including the data console |
| admin@gmail.com | org_admin | everything except owner-only screens |
| seller@gmail.com | seller | catalog, orders, customers, dispatch, loading |
| warehouse@gmail.com | inventory | warehouse tasks |
| driver1@gmail.com | driver | driver deck (one of two seeded live runs) |
| driver2@gmail.com | driver | driver deck (the other seeded live run) |

The login page has a dev-only **"Dev: pick an account"** dialog that fills the
form from that same list. It is compiled out when `NODE_ENV === "production"`,
so never move the password out of that guarded block.
