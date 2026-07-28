# Sales Section Improvement — Catalog Units, Images & Fixes

**Date:** 2026-07-29
**Status:** Approved design, pending implementation plan
**Scope:** Seller dashboard Sales section (Products, Orders, Customers) + minimal buyer-portal ripple

## Context

AyamNorliza is a chicken-ordering system. Sellers manage a catalog
(`categories → products → product_variants`), create orders for phone
customers, and manage a customer list. A separate buyer portal
(`src/app/buyer_portal/`) sells from the same catalog tables.

The Products page is currently broken (Add Category fails) and the catalog
cannot express how chicken is actually sold (per kg vs per piece), has no
product images in the UI, and the main client component is a 600-line
monolith.

## Confirmed decisions

| Decision | Choice |
|---|---|
| Pricing model | Mixed: each variant is `per_kg` or `per_piece` |
| Images | Upload to Supabase Storage (`product-images` bucket) |
| Stock | Availability toggle only (existing `is_available`) — no stock counts |
| Products page layout | Card grid with images, category filter chips |
| Buyer portal | Minimal ripple only: unit-aware prices + decimal kg quantities |
| Schema approach | Single `unit_type` column on `product_variants` (Approach A) |
| Refactor | Targeted split of `products-client.tsx`; no rewrite |

## Bugs found (all fixed in this round)

1. **Add Category/Product/Variant broken** —
   `src/app/(seller)/[organizationSlug]/products/products-client.tsx` passes
   `organizationSlug` (a slug string) to `createCategory` / `createProduct` /
   `createVariant`, whose first parameter is `orgId`; the slug is inserted
   into the uuid `organization_id` column and Postgres rejects it. Fix: the
   server page passes `organizationId` (uuid) to the client, matching the
   Customers page pattern.
2. **Category pushed into products state** — `handleCreateCategory` does
   `setProducts([...products, { ...newCategory, variants: [] }])`. Remove.
3. **No DELETE RLS policies** — `categories`, `products`, `product_variants`,
   `customers` have select/insert/update policies only; every delete
   silently affects 0 rows. Add delete policies (owner/org_admin/seller).
4. **`requireSellerRole` queries without a user filter** —
   `src/features/seller/server/actions.ts` selects from
   `organization_members` by organization only; add
   `.eq("user_id", auth.uid())` equivalent via `supabase.auth.getUser()`.
5. **Dead revalidation** — `revalidatePath("/[organizationSlug]/products")`
   uses the literal placeholder string. Actions accept the real slug and
   revalidate `/{slug}/products` (and equivalents).
6. **React list keys** — fragments inside `categories.map` /
   `products.map` lack keys; fixed as part of the component split.

## Database migration

One new migration: `supabase/migrations/20260729000001_catalog_units_images_fixes.sql`

1. `product_variants.unit_type text not null default 'per_piece'`
   with `check (unit_type in ('per_kg','per_piece'))`.
   Existing rows become `per_piece` (backward compatible).
2. `order_items.quantity` and `buyer_order_items.quantity`:
   `integer` → `numeric(10,3)`, keep `check (quantity > 0)`.
3. DELETE RLS policies for `categories`, `products`, `product_variants`,
   `customers`: same membership predicate as the existing insert policies
   (active member with role owner/org_admin/seller). Orders remain
   non-deletable by design — cancellation is the workflow.
4. Storage: create `product-images` bucket (public read). Policies on
   `storage.objects`: sellers/org_admins/owners of an org may
   insert/update/delete objects under `{organization_id}/…`; public select.
5. After applying: regenerate `src/types/database.generated.ts`.

Semantics: `price_per_unit` is RM per kg when `unit_type = 'per_kg'`, RM per
piece when `'per_piece'`. `order_items.quantity` is kg (decimal, e.g. 1.5)
or piece count (whole number) accordingly. `subtotal = price_per_unit ×
quantity` is unchanged.

## UI & components

### Products page — card grid

`products-client.tsx` splits into components under
`src/features/seller/components/products/`:

- **`product-catalog.tsx`** — page header (Add Category / Add Product
  buttons), category filter chips (All + one per category; chips carry
  edit/delete affordances), and the responsive card grid of the selected
  category's products.
- **`product-card.tsx`** — product image (placeholder when `image_url` is
  null), name, description, variant rows rendered as
  `"Standard — RM 12.00 /kg"` / `"Large — RM 35.00 each"` with availability
  indicator, plus edit/delete/add-variant actions.
- **`category-dialog.tsx`**, **`product-dialog.tsx`**,
  **`variant-dialog.tsx`** — create/edit forms. Product dialog adds an
  image-upload field (client uploads to Storage at
  `product-images/{organizationId}/{uuid}`, stores the public URL in
  `products.image_url`). Variant dialog adds a unit selector
  (per kg / per piece) that updates the price label live.
- **`src/features/seller/lib/pricing.ts`** — pure helpers:
  `formatVariantPrice(variant)`, `formatQuantity(quantity, unitType)`
  ("1.5 kg" / "2 pcs"), `lineSubtotal(pricePerUnit, quantity)`.
- **`src/features/seller/lib/catalog-model.ts`** — pure helpers for
  grouping/filtering products by category (extracted so grid logic is
  unit-testable).

The route file `products/page.tsx` passes `organizationId` and
`organizationSlug`; `products-client.tsx` becomes a thin composition of the
above.

### Orders

- New Order flow (`orders/new/new-order-client.tsx`): quantity control is
  unit-aware — `per_kg` variants get a decimal input (0.5 steps, free typing
  allowed, min 0.1); `per_piece` variants keep integer steppers. Cart lines
  show `"Wings — 1.5 kg × RM 12.00/kg = RM 18.00"`.
- Orders list & detail: display quantities via `formatQuantity`; no
  structural changes.

### Customers

No structural change. Delete starts working via the new RLS policy.

### Buyer portal (minimal ripple)

- `product-card.tsx` (buyer): price shows unit — "RM 12.00 /kg" vs
  "RM 25.00 each".
- Cart context, cart page, checkout, and `src/app/api/buyer/cart/route.ts`:
  accept decimal quantities for `per_kg` items; integers for `per_piece`.
  Validation mirrors the seller side. No visual redesign.

## Data flow

Unchanged pattern: server components fetch via server actions
(`getCategories`, `getProducts`) and pass initial data; client components
call mutation server actions and update local state optimistically after
the action resolves; actions revalidate the real slug path.

## Error handling

- Existing toast pattern stays (`useToast`, destructive variant on error).
- Image upload failures surface inside the dialog; form input is preserved.
- Deleting a category that still has products hits the FK `on delete
  restrict`; the action catches code `23503` and throws
  "This category still has products. Move or delete them first."
- Server actions keep throwing `Error(message)`; clients catch and toast.

## Testing

- Vitest unit tests (existing `src/features/*/tests/unit/` pattern) for
  `pricing.ts` (per-kg vs per-piece formatting, subtotals, rounding) and
  `catalog-model.ts` (grouping, filtering, active/available rules).
- Implementation follows TDD (superpowers) — tests first for all pure
  logic; UI verified manually against the dev server.
- Existing test suite must stay green (`npm test`).

## Out of scope (explicitly)

- Stock/inventory counts and order-driven stock decrement.
- Buyer portal visual redesign.
- Order deletion (cancel is the workflow).
- Multi-currency; everything stays MYR.
