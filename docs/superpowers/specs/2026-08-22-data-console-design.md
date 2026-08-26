# Data Console — Design

**Date:** 2026-08-22
**Status:** Approved approach A (DB RPCs + thin page)

## Goal

A page where the owner can wipe all business data and re-seed the app with
realistic demo data (real product photos, Malay names, Johor postcodes), so
every page — products, customers, orders, tasks, dispatch, loading, runs,
driver deck, buyer portal — shows believable data instead of an empty state.

Users are never deleted. Two known logins must always exist after seeding:

| Email | Role | Password |
|---|---|---|
| `owner@gmail.com` | `owner` | `password123` |
| `admin@gmail.com` | `org_admin` | `password123` |
| `seller@gmail.com` | `seller` | `password123` |
| `warehouse@gmail.com` | `inventory` | `password123` |
| `driver1@gmail.com` | `driver` | `password123` |
| `driver2@gmail.com` | `driver` | `password123` |

## Non-goals

- No user-approval flow (dropped during brainstorming).
- No per-section clear buttons — one "clear everything except users" action.
- No storage uploads — product images are served from `public/product/` as
  static assets referenced by `products.image_url`.

## Architecture

Three pieces:

1. **`admin_clear_org_data(p_organization_id uuid)`** — SQL RPC,
   `security definer`. Verifies the caller is an **active `owner` member** of
   that organization (raises `insufficient_privilege` otherwise), then deletes
   all business rows for the org in one transaction, child tables first.
2. **`admin_seed_demo_data(p_organization_id uuid)`** — SQL RPC,
   `security definer`, same owner check. Calls `admin_clear_org_data`
   internally, then inserts the full demo dataset with **deterministic UUIDs**
   (fixed `dd000000-…` prefix) so re-seeding is idempotent and stable across
   runs.
3. **Server action `ensureConsoleUsers`** — Next.js server action using the
   service-role client. Creates the two accounts above via
   `auth.admin.createUser` if missing (email confirmed, profile row, org
   membership with the right role). Runs as step 1 of the Seed flow; the RPC
   handles everything else.

The page itself holds no data logic — it renders two actions and calls them.

### Why RPCs (approach A)

RLS/RPC is this codebase's only trusted authorization boundary. Wipe and seed
are single DB transactions — a failure mid-way rolls back instead of leaving a
half-deleted FK graph. Both RPCs are pgTAP-testable like the existing order
pipeline functions.

## Page

- **Route:** `src/app/(seller)/[organizationSlug]/data-console/page.tsx`
  (+ a `data-console-client.tsx` client component, matching the
  `runs`/`tasks` page pattern).
- **Access:** server component resolves membership; renders 404 (`notFound()`)
  unless the caller is an active `owner` of the org. Available in production —
  accepted risk, see Security notes.
- **Sidebar:** entry in `app-sidebar.tsx`, visible to owners only, labelled
  "Data console".
- **UI:** two cards.
  - **Clear all data** — destructive card. Requires typing `PADAM SEMUA`
    before the button enables, then calls a server action that invokes
    `admin_clear_org_data`. *Implementation deviation (2026-08-22):* the
    type-to-confirm input sits inline on the card rather than inside a
    dialog; the safety property (typed phrase gates the button) is intact.
  - **Seed demo data** — button with a short summary of what gets created.
    Confirm dialog (plain confirm, no typed phrase — it is destructive too,
    since it clears first, so the dialog says so). Calls a server action that
    runs `ensureConsoleUsers` then `admin_seed_demo_data`.
- Both actions report success/failure with the row counts returned by the RPC
  (e.g. "Cleared 214 rows" / "Seeded 13 products, 10 customers, 15 orders").
- Errors surface through the existing `rpc-errors.ts` mapping.

## Clear scope

Deleted (org-scoped rows only, child → parent order):

`order_weight_log`, `order_tasks`, `order_items`, `run_stop_events`,
`delivery_attempts`, `orders`, `buyer_order_items`, `buyer_orders`,
`delivery_runs`, `customers`, `product_variants`, `products`, `categories`,
`zone_postcode_ranges`, `truck_zones`, `trucks`, `bays`, `delivery_slots`,
`delivery_zones`, `facilities`, `schedule_blocks`.

Kept: `organizations`, `organization_members`, `profiles`, `buyers`,
`invitations`, `auth.users`, and all append-only audit/security tables
(`audit_log`, `auth_security_events`, …).

`buyers.customer_id` is set to `null` before `customers` is deleted; the seed
re-creates a customer row for each existing buyer and relinks it, so buyer
logins keep working end-to-end.

## Seed dataset

All rows use deterministic UUIDs and belong to the caller's organization.

- **Catalog:** 1 category "Ayam Segar"; 13 products, one per image in
  `public/product/` with `image_url` = `/product/<filename>`:
  Ayam Pedaging Seekor Standard, Ayam Kampung Seekor, Ayam Tua (Penelur)
  Seekor, Dada Ayam, Peha Ayam, Pengkal Peha, Kepak Ayam, Chicken Wing,
  Kaki Ayam, Kepala/Leher Ayam, Hati Ayam, Rangka Ayam, Cop Ayam.
  Each product gets 1–2 variants with realistic RM prices (per kg / per ekor).
- **Customers:** 10 with Malay names, `01x-xxxxxxx` phones, Johor addresses
  whose postcodes fall inside the zone bands below.
- **Logistics setup** (matches the delivery setup console screenshots):
  1 facility; bays **Bay A**, **Bay B**; zones **Zone 1** (79000–82999),
  **Zone 2** (83000–84999), **Zone 3** (85000–86999); trucks **TRK-A**
  (South Zone), **TRK-B** (West Coast Zone), **TRK-C** (North & East Zone)
  with `truck_zones` links.
- **Orders:** ~15 spread across the pipeline — pending, confirmed (some
  weighed with `order_weight_log` entries, some with open `order_tasks`),
  ready (assigned to trucks/runs), delivered, plus one cancelled. Order dates
  span today and the last few days so the kanban, tasks page, weigh station,
  dispatch board and loading bay board all have content.
- **Runs:** 2 `delivery_runs` — one for today in loading state carrying the
  ready orders, one completed yesterday with delivered orders and
  `run_stop_events` history.
- ~~**Buyer orders:** 2 `buyer_orders` for the existing E2E buyer.~~
  **Implementation deviation (2026-08-22):** `buyer_orders` /
  `buyer_order_items` were dropped by migration 20260810000001 when portal
  orders were unified into `public.orders` (`source='portal'`); this spec
  item predated that discovery and was removed from the seed. Buyer logins
  still get a relinked `customers` row, so they can place portal orders
  themselves.

Dates are computed relative to `now()` inside the RPC, so the data always
looks fresh no matter when seeding runs.

## Error handling

- Both RPCs raise `insufficient_privilege` for non-owners; unknown org raises
  `no_data_found`. `rpc-errors.ts` maps these to the existing user-facing
  error shapes.
- The seed RPC is a single transaction: any FK/constraint failure rolls back
  everything, page shows the error, database stays in the pre-seed state.
- `ensureConsoleUsers` failures (e.g. missing service-role key) abort the seed
  flow before the RPC runs and are reported on the page.

## Testing

- **pgTAP** (`supabase/tests/rls/`): owner can clear and seed; `seller` /
  `org_admin` / non-member get `insufficient_privilege`; clear preserves
  `auth.users`, `organization_members`, `profiles`, `buyers`; seed is
  idempotent (running twice leaves the same row counts).
- **Vitest:** unit test for the page's gate model (owner sees page, others
  404) following the existing dashboard-shell-model test pattern.
- **Playwright (optional smoke):** log in as seeded owner, open the console,
  run seed, assert products page shows 13 products.

## Security notes (accepted risks)

- The page and both RPCs work **in production** for owner logins. A stolen
  owner session can wipe live data. Mitigation: type-to-confirm phrase, and
  the wipe is org-scoped — other tenants are untouched.
- `password123` for every console account is committed to the repo. Anyone with repo
  access can log into production as owner. Flagged and accepted by Hafiz for
  this pilot; revisit before real customer data lands.
