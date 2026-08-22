# Customer–Buyer Sync Design

**Date:** 2026-08-23
**Status:** Approved

## Problem

Two disconnected customer populations:

- `customers` — CRM rows the seller/admin creates (name, phone, address, notes). No email column.
- `buyers` — self-signup portal accounts (auth user + display_name, phone). A nullable `buyers.customer_id` FK exists, but it is only populated lazily by `place_order` on the buyer's first order.

Result: portal signups are invisible in the seller's Customers list until they order, phone-format differences create duplicates, and the seller cannot record an email for a manually created customer.

## Goal

One synced customer list. A buyer account always has a linked `customers` row from the moment of signup. The admin dialog and the buyer signup form converge on the same core fields (name + phone required, email optional for admin). Sellers can see at a glance which customers have portal accounts.

Out of scope: portal invite flow for admin-entered emails (future feature), merging the two tables, a manual merge UI, syncing buyer delivery addresses into `customers.address`.

## Decisions (from brainstorming)

1. **Dedup:** auto-link on normalized phone match within the organization.
2. **Display:** "Portal" badge on linked rows; email shown in the list.
3. **Admin email field:** contact data only — no invite, no password, no account creation.
4. **Mechanism:** database trigger on `buyers` insert (not an app-level RPC call) — sync is a data-integrity invariant, enforced where RLS already is.

## Schema (one migration)

- `customers.email text null`.
- `normalize_phone(text)` — immutable SQL function: strip non-digit characters, then rewrite a leading `60` (country code, length > 9) to `0`. `012-7223344`, `+60127223344`, and `0127223344` all normalize identically.
- `customers.phone_normalized text generated always as (normalize_phone(phone)) stored`, plus an index on `(organization_id, phone_normalized)`.
- No changes to `buyers`.

## Sync trigger

`AFTER INSERT ON public.buyers`, SECURITY DEFINER, sharing one function with the backfill:

1. Read the buyer's email from `auth.users`; normalize the buyer's phone.
2. Find a candidate: same `organization_id`, same `phone_normalized`, **not already claimed** by another buyer. Multiple candidates (pre-existing duplicates) → oldest `created_at` wins.
3. Match → set `buyers.customer_id`; fill `customers.email` only when it is null. The seller's name, address, and notes are never overwritten.
4. No match, or buyer phone empty → insert a new `customers` row (name = display_name, phone, email, `organization_id` = buyer's org, `created_by` = the buyer's auth user id — mirroring what `place_order` already does) and link it.
5. No stealing: a customer row already claimed by another buyer is treated as no match.

A trigger failure aborts the whole signup transaction — no half-created buyers. The trigger performs only local inserts/updates; no external calls.

`place_order`'s lazy create-and-link stays untouched as a harmless fallback for any legacy buyer the backfill misses.

## Backfill (same migration, after the trigger)

- For every buyer with `customer_id is null`, run the same link-or-create logic via the shared function.
- For already-linked customers with `email is null`, fill email from `auth.users`.
- Idempotent; safe to re-run.

## App changes

**Admin Add/Edit Customer dialog** (`src/app/(seller)/[organizationSlug]/customers/customers-client.tsx`):
- New optional **Email** field between Phone and Address. Validated as an email format only when non-empty.
- `createCustomer` / `updateCustomer` server actions and their zod schemas accept `email`.

**Customers table** (same file):
- "Portal" badge next to the name for rows with a linked buyer account.
- Email rendered as a muted second line under the name — no new column.
- `getCustomers()` selects `email` and a `has_portal_account` flag via a left join on `buyers.customer_id`.

**Buyer signup form** (`src/app/buyer_portal/[organizationSlug]/login/page.tsx`):
- Phone becomes **required** — it is the match key. Both creation paths now require name + phone.

**Edit rule:** the seller edits any customer row freely, including portal-linked ones; the customer row is the seller's CRM view and edits never affect the buyer's login.

## Tests

- **pgTAP** (`npm run db:test`): phone-match links; dashed and `+60` variants match; claimed customer is skipped and a new row created; no match creates a row; email fills only when null; seller fields survive linking; backfill is idempotent; table grants asserted explicitly (not inherited).
- **Vitest:** zod email validation on the customer create/update schemas.
- **Playwright e2e:** buyer signup → row appears in Customers with the Portal badge; admin creates a customer, buyer signs up with the same phone → linked, no duplicate row.
