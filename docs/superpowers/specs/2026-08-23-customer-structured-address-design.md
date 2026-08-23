# Customer Structured Address Design

**Date:** 2026-08-23
**Status:** Approved

## Problem

The seller's Add/Edit Customer dialog takes a single free-text `address`, while the buyer checkout takes a structured Malaysian address — address line, postcode, state, area — via the `AddressFields` component, which auto-fills state and area from a typed postcode. Two forms capture the same real-world thing in two shapes.

The cost is not only cosmetic. Manual order creation makes the seller retype the delivery address and postcode on every order; the selected customer's saved address is shown read-only and never used. Because the customer record holds no postcode, the existing `resolve_zone_for_postcode` function cannot pick the delivery zone for them either.

## Goal

Customers get the same structured address as buyers, entered through the same component, and that structure pays for itself: selecting a customer during manual order creation prefills the delivery address and postcode and auto-resolves the delivery zone.

Out of scope: changing how orders store their delivery address (`orders.delivery_address` stays free text plus `postcode`); a customer address book (customers keep exactly one address); zone coverage UI for sellers; stripping postcodes out of existing free-text address lines.

## Decisions (from brainstorming)

1. **Optional, all-or-nothing in the form.** Address fields may be left entirely blank, but a non-blank address requires a postcode (which auto-fills state and area).
2. **Both create paths, plus the payoff.** The Add/Edit Customer dialog and the inline "New customer" form in manual order creation both use `AddressFields`; selecting a customer prefills the order's delivery address and postcode and auto-resolves the zone.
3. **Best-effort backfill.** Existing free-text addresses are regexed for an embedded 5-digit postcode; unparseable ones stay null.

## Schema

Three nullable columns on `public.customers`:

- `postcode text` — `check (postcode is null or postcode ~ '^[0-9]{5}$')`
- `state text` — `check (state is null or char_length(state) between 1 and 50)`
- `area text` — `check (area is null or char_length(area) between 1 and 100)`

Plus one table constraint. State and area only ever arrive together, and only ever derived from a postcode:

```sql
(state is null and area is null)
or (state is not null and area is not null and postcode is not null)
```

Legal: nothing · address alone · address + postcode · all four. Rejected: state without area, state or area without a postcode.

`address` keeps its name. Renaming it to `address_line` for symmetry with `buyer_addresses` would touch every consumer for a cosmetic gain.

### Why the database is looser than the form

A strict all-four-or-nothing database constraint would make every legacy row unsaveable until someone completed its address, including rows whose postcode cannot be parsed. So all-or-nothing is enforced in the form; the database tolerates address-alone as the legacy state.

### Backfill

In the same migration, extract a standalone 5-digit token from `address` into `postcode` (`"3 Jalan Bakri, 84000 Muar"` → `84000`). No match leaves `postcode` null. The `address` text is not modified.

State and area cannot be backfilled in SQL — the postcode dataset is a vendored JSON file, not a table — and they are not needed for zone resolution, which keys on postcode alone. Instead the edit dialog completes them client-side: on open, when a postcode is present but state and area are not, it runs the dataset lookup. Any backfilled customer self-completes the first time a seller opens it.

## Component relocation

`AddressFields` moves from `src/features/buyer/components/address-fields.tsx` to `src/components/forms/address-fields.tsx`, where cross-feature form components already live, and the dataset moves from `src/features/buyer/lib/malaysia-postcodes.{ts,json}` to `src/lib/`. The generator script's output path, the dataset unit test, and the checkout client's import move with them.

The component gains one prop: `idPrefix?: string`, defaulting to `"address"` so buyer checkout keeps its current element ids. This is required rather than speculative — the manual order page renders two address blocks simultaneously (the order's own delivery section and the inline new-customer form), and the component hardcodes ids like `address-postcode`.

## UI

**Add/Edit Customer dialog** (`customers-client.tsx`): fields become Name\*, Phone\*, Email, `<AddressFields>`, Notes.

**Inline "New customer"** (`new-order-client.tsx`): the single-line address input becomes the same `<AddressFields>` block with `idPrefix="customer"`.

**Server actions**: `createCustomer` and `updateCustomer` accept `postcode`, `state`, and `area`. A new `parseCustomerAddress` in `src/features/seller/lib/customer-schema.ts` enforces the form rule — blank is fine, a non-blank address requires a valid 5-digit postcode, and state and area must both be present or both absent. `getCustomers` and `searchCustomers` pick the new columns up through `select *`.

The customers table's Address cell is unchanged: the address line, truncated.

## Order prefill

A new `resolveDeliveryZone(organizationSlug, postcode)` server action in `src/features/orders/server/order-actions.ts` mirrors the buyer-side `resolveZoneForPostcode` but guards with `guardRoles(..., MANAGER_ROLES)` instead of `requireBuyer()`. It calls the existing `resolve_zone_for_postcode` RPC, already granted to `authenticated`. `place_order` is unchanged — it already accepts `p_postcode`, and the client already sends it.

On customer select, and after an inline customer is created:

1. `customer.address` fills the delivery address textarea.
2. `customer.postcode` fills the postcode field.
3. `resolveDeliveryZone` runs; on a hit, the client drives the same `handleZoneChange` path a manual pick would, so delivery slots load normally.

Selecting a customer is an explicit action, so it overwrites whatever is in those fields. On a miss the zone selection is left untouched and a toast reads "No delivery zone covers &lt;postcode&gt; — pick one manually."

## Tests

- **pgTAP**: the constraint rejects state-without-area and state-or-area-without-postcode, and accepts address-alone; the backfill extracts an embedded postcode and leaves an unparseable address null.
- **Vitest**: `parseCustomerAddress` across blank, complete, address-without-postcode, malformed postcode, and state-without-area; `resolveDeliveryZone` mirroring `portal-resolve-zone.test.ts`, asserting the manager guard and the RPC arguments.
- **Playwright**: seed a zone with postcode coverage, create a customer with a structured address inside that range, start a manual order, select the customer, and assert the address and postcode are prefilled and the zone is auto-selected.
