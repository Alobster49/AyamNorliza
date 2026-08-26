# AyamNorliza — project instructions

## Test accounts

Whenever you create an account for testing (local Supabase, seeds, e2e fixtures,
manual QA), always use the password `password123`. Do not invent a different
password per account — the whole team expects this one.

Current local pilot accounts (`ayam-norliza-pilot`):

| Email | Password | Role | Display name |
|---|---|---|---|
| owner@gmail.com | password123 | owner | CEO Badrol |
| admin@gmail.com | password123 | org_admin | Hafiz Samad |

Note: `src/features/data-console/server/actions.ts` still seeds its console
accounts with `Password123!` (`CONSOLE_PASSWORD`). Anything you create by hand
uses `password123`.
