# Buyer Signup Phone, Address Book & Auto Zone Resolution — Design

Date: 2026-08-22
Status: Approved

## Problem

The buyer portal checkout asks buyers to hand-pick a delivery zone they cannot
reasonably know, and to retype their full address on every order. Signup does
not collect a phone number, which blocks the planned WhatsApp features.

## Decisions (made with Hafiz)

1. **Zone mapping**: seller maps postcodes to zones. The
   `zone_postcode_ranges` table and its seller admin UI (delivery page)
   already exist — only buyer-side resolution is new.
2. **Auth gate**: shop and cart stay public; login is forced at checkout.
3. **Address book**: multiple saved addresses per buyer with a default.

## Scope

### 1. Signup phone

- Signup tab of `src/app/buyer_portal/[organizationSlug]/login/page.tsx`
  gains a required Phone field.
- Accepted input: Malaysian mobile `01XXXXXXXX` (9–10 digits after the 01)
  or `+601XXXXXXXX`; spaces and dashes tolerated. Normalized to `+601…`
  E.164 form before save (WhatsApp-ready).
- `buyerSignUpAction` (`src/features/buyer-auth/server/auth-actions.ts`)
  validates + normalizes and writes `buyers.phone` (column already exists,
  check 5–20 chars).

### 2. Checkout auth gate

- `checkout/page.tsx`: when signed out, redirect to
  `/buyer_portal/[slug]/login?next=/buyer_portal/[slug]/checkout`.
- Login page honors a same-origin, same-portal-prefix `next` param after
  successful sign-in or sign-up (validate: must start with
  `/buyer_portal/[slug]/`).

### 3. Address book — new table `buyer_addresses`

```sql
create table public.buyer_addresses (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.buyers(id) on delete cascade,
  address_line text not null check (char_length(address_line) between 1 and 500),
  postcode text not null check (postcode ~ '^[0-9]{5}$'),
  state text not null check (char_length(state) between 1 and 50),
  area text not null check (char_length(area) between 1 and 100),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

- Partial unique index: at most one `is_default = true` per buyer.
- RLS: buyer full CRUD on own rows (`buyer_id = auth.uid()`); no seller
  access.
- Server actions in `src/features/buyer/server/address-actions.ts`:
  `listAddresses`, `createAddress`, `setDefaultAddress`, `deleteAddress`.
  Zod-validated, `ActionResult` shape as elsewhere.
- Checkout: saved addresses render as a picker (default preselected);
  "New address" opens the structured form. A new address used on a
  successful order is saved automatically (as default when it is the
  buyer's first).

### 4. Malaysia postcode dataset

- Vendored JSON in `src/features/buyer/lib/malaysia-postcodes.json`
  derived from the public `malaysia-postcodes` dataset
  (postcode → city/area + state, ~2.7k postcode groups, all 16
  states/federal territories).
- Lookup helpers in `src/features/buyer/lib/malaysia-postcodes.ts`:
  - `lookupPostcode(postcode)` → `{ state, area } | null`
  - `statesList()` → 16 states/FTs
  - `areasForState(state)` → sorted area names
- Address form behavior: typing a 5-digit postcode auto-fills state and
  area; state dropdown lists all states; area dropdown is shortlisted by
  the chosen state. Auto-fill is a suggestion — manual override stays
  possible (dataset gaps exist).

### 5. Zone auto-resolution (zone dropdown removed)

- New migration: security-definer RPC
  `public.resolve_zone_for_postcode(p_org uuid, p_postcode text) returns uuid`:
  - validates `^[0-9]{5}$`, else `invalid_postcode`;
  - picks matching ranges `postcode_start <= p_postcode <= postcode_end`
    joined to active zones of the org;
  - overlap tie-break: first match by zone name (matches the
    `zone_postcode_ranges` table comment);
  - returns zone id or null (no match);
  - `grant execute to authenticated` (checkout is behind login).
- Checkout drops the zone `Select`. When a valid postcode is present the
  page resolves the zone silently, then loads delivery options for it.
  No match → "No delivery to your area yet." and submit stays disabled.
- `place_order` RPC unchanged; the resolved zone id is passed exactly as
  the hand-picked one was. `delivery_address` is composed as
  `address_line, postcode area, state`; `postcode` passed separately as
  today.

## Error handling

- Phone validation errors surface inline on the signup form.
- Resolver errors degrade to the "no delivery" state, never a crash.
- Address actions return `ActionResult` codes: `validation`,
  `unauthenticated`, `internal`.
- Deleting the default address: oldest remaining address becomes default
  (single UPDATE in the same action), or none if list is empty.

## Testing

- Unit (vitest, repo pattern): phone normalization matrix; postcode lookup
  helpers (hit, miss, state shortlist); address actions (CRUD + default
  juggling, mocked supabase per existing action tests).
- SQL: resolver RPC covered via migration test path used by existing RPC
  tests if present, otherwise exercised through an action-level test.
- E2E (`e2e/`): signup with phone → add to cart → checkout redirected to
  login → sign in → new address with postcode auto-fill → zone resolved →
  order placed → revisit checkout shows saved address preselected.

## Out of scope

- WhatsApp sending itself (phone capture only).
- Seller mapping UI changes (already shipped on the delivery page).
- Backfill/migration of the legacy `buyers.address` free-text column.
- Non-Malaysian addresses.
