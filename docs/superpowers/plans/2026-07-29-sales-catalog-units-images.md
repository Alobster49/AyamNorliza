# Sales Catalog Units, Images & Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken seller catalog (Add Category/Product/Variant, silent deletes), add per-kg/per-piece pricing with decimal quantities, product image uploads, and a card-grid Products page, with a minimal buyer-portal ripple.

**Architecture:** One DB migration adds `product_variants.unit_type`, widens order-item quantities to `numeric(10,3)`, adds missing DELETE RLS policies, and creates a public `product-images` Storage bucket. Pure pricing/catalog helpers live in `src/features/seller/lib/` and are unit-tested. The 600-line `products-client.tsx` splits into card/dialog components. Buyer portal gets unit-aware prices and decimal kg quantities only.

**Tech Stack:** Next.js 15 (App Router, server actions), Supabase (Postgres, RLS, Storage), TypeScript, Tailwind + shadcn-style components in `src/components/ui/`, vitest.

**Spec:** `docs/superpowers/specs/2026-07-29-sales-catalog-design.md`

## Global Constraints

- Currency is MYR, formatted with `Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" })`.
- `unit_type` values are exactly `'per_kg'` and `'per_piece'`; DB default `'per_piece'`.
- Storage bucket name is exactly `product-images`; object paths are `{organization_id}/{random-uuid}.{ext}`.
- Orders are never deleted (cancel is the workflow); do NOT add delete policies for `orders`/`order_items`.
- No stock counts — availability stays the existing `is_available` / `is_active` booleans.
- Unit tests use vitest, pattern `src/features/<feature>/tests/unit/*.test.ts`. Run with `npm test`.
- Type check with `npx tsc --noEmit`; the existing suite must stay green after every task.
- All SQL is lowercase, wrapped in `begin;`/`commit;`, matching existing migrations.
- Local Supabase must be running for migration/type-gen tasks (`npx supabase start` or the repo's `START-PROJECT.command`).

---

### Task 1: Database migration + regenerated types

**Files:**
- Create: `supabase/migrations/20260729000001_catalog_units_images_fixes.sql`
- Regenerate: `src/types/database.generated.ts`
- Modify: `src/features/seller/types.ts` (append unit-type exports)

**Interfaces:**
- Consumes: existing tables from `20260718000001_seller_role_and_catalog.sql` and `20260718120000_buyer_portal.sql`.
- Produces: `product_variants.unit_type` (text), `order_items.quantity`/`buyer_order_items.quantity` as `numeric(10,3)`, DELETE policies, `product-images` bucket. TypeScript: `UnitType`, `UNIT_TYPES`, `UNIT_TYPE_LABELS` exported from `@/features/seller/types`; `product_variants` rows gain `unit_type: string`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260729000001_catalog_units_images_fixes.sql`:

```sql
-- 20260729000001_catalog_units_images_fixes.sql
-- Catalog units (per_kg/per_piece), decimal order quantities, missing DELETE
-- RLS policies, and the product-images storage bucket.

begin;

-- ---------------------------------------------------------------------------
-- 1. unit_type on product_variants
--    price_per_unit means RM per kg when 'per_kg', RM per piece when 'per_piece'.
-- ---------------------------------------------------------------------------
alter table public.product_variants
  add column if not exists unit_type text not null default 'per_piece'
  constraint product_variants_unit_type_check check (unit_type in ('per_kg', 'per_piece'));

comment on column public.product_variants.unit_type is
  'How this variant is sold: per_kg (decimal quantities) or per_piece (integer quantities).';

-- ---------------------------------------------------------------------------
-- 2. Decimal quantities (e.g. 1.5 kg). Existing check (quantity > 0) survives.
-- ---------------------------------------------------------------------------
alter table public.order_items alter column quantity type numeric(10,3);
alter table public.buyer_order_items alter column quantity type numeric(10,3);

-- ---------------------------------------------------------------------------
-- 3. Missing DELETE RLS policies. Without these, every delete silently
--    affects 0 rows. Orders are intentionally NOT deletable (cancel instead).
-- ---------------------------------------------------------------------------
create policy "categories_delete" on public.categories
  for delete using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "products_delete" on public.products
  for delete using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "product_variants_delete" on public.product_variants
  for delete using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "customers_delete" on public.customers
  for delete using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

-- ---------------------------------------------------------------------------
-- 4. product-images storage bucket (public read; sellers write within own org
--    folder: object names are '{organization_id}/{uuid}.{ext}').
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "product_images_public_read" on storage.objects
  for select using (bucket_id = 'product-images');

create policy "product_images_seller_insert" on storage.objects
  for insert with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] in (
      select organization_id::text from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "product_images_seller_update" on storage.objects
  for update using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] in (
      select organization_id::text from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "product_images_seller_delete" on storage.objects
  for delete using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] in (
      select organization_id::text from public.organization_members
      where user_id = auth.uid() and status = 'active'
      and role in ('owner', 'org_admin', 'seller')
    )
  );

commit;
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase migration up`
Expected: `Applying migration 20260729000001_catalog_units_images_fixes.sql...` with no errors.

- [ ] **Step 3: Verify schema**

Run: `psql "$(npx supabase status --output json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["DB_URL"])')" -c "\d public.product_variants" -c "select id, public from storage.buckets where id = 'product-images';" -c "select polname from pg_policies where tablename = 'categories';"`

(If the `npx supabase status` JSON shape differs, get the DB URL from `npx supabase status` output — the default local URL is `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.)

Expected: `unit_type | text | not null | 'per_piece'::text` column present; bucket row `product-images | t`; policies include `categories_delete`.

- [ ] **Step 4: Regenerate DB types**

Run: `npx supabase gen types typescript --local > src/types/database.generated.ts`
Expected: file regenerated; `grep -n "unit_type" src/types/database.generated.ts` shows `unit_type: string` in `product_variants` Row/Insert(optional)/Update(optional).

- [ ] **Step 5: Add unit-type exports to seller types**

Append to `src/features/seller/types.ts`:

```typescript
export type UnitType = "per_kg" | "per_piece";

export const UNIT_TYPES: readonly UnitType[] = ["per_kg", "per_piece"] as const;

export const UNIT_TYPE_LABELS: Record<UnitType, string> = {
  per_kg: "Per kg",
  per_piece: "Per piece",
};
```

- [ ] **Step 6: Type check and existing tests**

Run: `npx tsc --noEmit && npm test`
Expected: both pass (no consumers of `unit_type` yet).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260729000001_catalog_units_images_fixes.sql src/types/database.generated.ts src/features/seller/types.ts
git commit -m "feat(db): variant unit_type, decimal quantities, delete RLS, product-images bucket"
```

---

### Task 2: Pricing helpers (TDD)

**Files:**
- Create: `src/features/seller/lib/pricing.ts`
- Test: `src/features/seller/tests/unit/pricing.test.ts`

**Interfaces:**
- Consumes: `UnitType` from `@/features/seller/types` (Task 1).
- Produces (used by Tasks 7–10):
  - `formatPrice(amount: number): string` — MYR string, e.g. `RM 12.00`.
  - `formatVariantPrice(pricePerUnit: number, unitType: UnitType): string` — `formatPrice(x) + " /kg"` or `+ " each"`.
  - `formatQuantity(quantity: number, unitType: UnitType): string` — `"1.5 kg"` / `"2 pcs"`.
  - `lineSubtotal(pricePerUnit: number, quantity: number): number` — rounded to 2 dp.
  - `isValidQuantity(quantity: number, unitType: UnitType): boolean` — `> 0`; integers required for `per_piece`.

- [ ] **Step 1: Write the failing tests**

Create `src/features/seller/tests/unit/pricing.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  formatPrice,
  formatQuantity,
  formatVariantPrice,
  isValidQuantity,
  lineSubtotal,
} from "../../lib/pricing";

describe("formatPrice", () => {
  it("formats MYR with two decimals", () => {
    // Intl may use a non-breaking space; match flexibly.
    expect(formatPrice(12)).toMatch(/^RM\s?12\.00$/);
    expect(formatPrice(1234.5)).toMatch(/^RM\s?1,234\.50$/);
  });
});

describe("formatVariantPrice", () => {
  it("suffixes /kg for per_kg", () => {
    expect(formatVariantPrice(12, "per_kg")).toBe(`${formatPrice(12)} /kg`);
  });
  it("suffixes each for per_piece", () => {
    expect(formatVariantPrice(25, "per_piece")).toBe(`${formatPrice(25)} each`);
  });
});

describe("formatQuantity", () => {
  it("shows kg with up to 3 decimals, trimmed", () => {
    expect(formatQuantity(1.5, "per_kg")).toBe("1.5 kg");
    expect(formatQuantity(2, "per_kg")).toBe("2 kg");
    expect(formatQuantity(0.25, "per_kg")).toBe("0.25 kg");
  });
  it("shows pcs for per_piece", () => {
    expect(formatQuantity(2, "per_piece")).toBe("2 pcs");
    expect(formatQuantity(1, "per_piece")).toBe("1 pc");
  });
});

describe("lineSubtotal", () => {
  it("multiplies and rounds to 2dp", () => {
    expect(lineSubtotal(12, 1.5)).toBe(18);
    expect(lineSubtotal(9.99, 0.333)).toBe(3.33);
  });
});

describe("isValidQuantity", () => {
  it("accepts decimals for per_kg", () => {
    expect(isValidQuantity(1.5, "per_kg")).toBe(true);
    expect(isValidQuantity(0, "per_kg")).toBe(false);
    expect(isValidQuantity(-1, "per_kg")).toBe(false);
  });
  it("requires positive integers for per_piece", () => {
    expect(isValidQuantity(2, "per_piece")).toBe(true);
    expect(isValidQuantity(1.5, "per_piece")).toBe(false);
    expect(isValidQuantity(0, "per_piece")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/features/seller/tests/unit/pricing.test.ts`
Expected: FAIL — cannot resolve `../../lib/pricing`.

- [ ] **Step 3: Implement**

Create `src/features/seller/lib/pricing.ts`:

```typescript
/**
 * Pure pricing/quantity formatting helpers for the catalog.
 * price_per_unit is RM per kg for per_kg variants, RM per piece otherwise.
 */

import type { UnitType } from "../types";

const myr = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

export function formatPrice(amount: number): string {
  return myr.format(amount);
}

export function formatVariantPrice(pricePerUnit: number, unitType: UnitType): string {
  const suffix = unitType === "per_kg" ? "/kg" : "each";
  return `${formatPrice(pricePerUnit)} ${suffix}`;
}

export function formatQuantity(quantity: number, unitType: UnitType): string {
  if (unitType === "per_kg") {
    // Up to 3 decimals, trailing zeros trimmed by Number().
    return `${Number(quantity.toFixed(3))} kg`;
  }
  return `${quantity} ${quantity === 1 ? "pc" : "pcs"}`;
}

export function lineSubtotal(pricePerUnit: number, quantity: number): number {
  return Math.round(pricePerUnit * quantity * 100) / 100;
}

export function isValidQuantity(quantity: number, unitType: UnitType): boolean {
  if (!Number.isFinite(quantity) || quantity <= 0) return false;
  if (unitType === "per_piece") return Number.isInteger(quantity);
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/features/seller/tests/unit/pricing.test.ts`
Expected: PASS (all 5 describes).

- [ ] **Step 5: Commit**

```bash
git add src/features/seller/lib/pricing.ts src/features/seller/tests/unit/pricing.test.ts
git commit -m "feat(seller): unit-aware pricing helpers"
```

---

### Task 3: Catalog model helpers (TDD)

**Files:**
- Create: `src/features/seller/lib/catalog-model.ts`
- Test: `src/features/seller/tests/unit/catalog-model.test.ts`

**Interfaces:**
- Consumes: `Category`, `Product`, `ProductVariant` from `@/features/seller/types`.
- Produces (used by Task 7):
  - `type CatalogProduct = Product & { variants: ProductVariant[]; category?: Category | null }`
  - `filterByCategory(products: CatalogProduct[], categoryId: string | null): CatalogProduct[]` — `null` means all.
  - `countByCategory(products: CatalogProduct[]): Map<string, number>`
  - `sortCategories(categories: Category[]): Category[]` — by `display_order` asc, then `name`.

- [ ] **Step 1: Write the failing tests**

Create `src/features/seller/tests/unit/catalog-model.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  countByCategory,
  filterByCategory,
  sortCategories,
  type CatalogProduct,
} from "../../lib/catalog-model";
import type { Category } from "../../types";

function category(overrides: Partial<Category>): Category {
  return {
    id: "cat-1",
    organization_id: "org-1",
    name: "Whole Chicken",
    description: null,
    display_order: 0,
    is_active: true,
    created_by: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    version: 1,
    ...overrides,
  };
}

function product(overrides: Partial<CatalogProduct>): CatalogProduct {
  return {
    id: "prod-1",
    organization_id: "org-1",
    category_id: "cat-1",
    name: "Whole Chicken",
    description: null,
    image_url: null,
    is_active: true,
    created_by: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    version: 1,
    variants: [],
    ...overrides,
  };
}

describe("filterByCategory", () => {
  const products = [
    product({ id: "p1", category_id: "cat-1" }),
    product({ id: "p2", category_id: "cat-2" }),
  ];

  it("returns all products for null", () => {
    expect(filterByCategory(products, null)).toHaveLength(2);
  });

  it("filters by category id", () => {
    expect(filterByCategory(products, "cat-2").map((p) => p.id)).toEqual(["p2"]);
  });
});

describe("countByCategory", () => {
  it("counts products per category", () => {
    const counts = countByCategory([
      product({ id: "p1", category_id: "cat-1" }),
      product({ id: "p2", category_id: "cat-1" }),
      product({ id: "p3", category_id: "cat-2" }),
    ]);
    expect(counts.get("cat-1")).toBe(2);
    expect(counts.get("cat-2")).toBe(1);
    expect(counts.get("cat-3")).toBeUndefined();
  });
});

describe("sortCategories", () => {
  it("sorts by display_order then name, without mutating input", () => {
    const input = [
      category({ id: "c1", name: "Frozen", display_order: 2 }),
      category({ id: "c2", name: "Bones", display_order: 1 }),
      category({ id: "c3", name: "Ayam", display_order: 1 }),
    ];
    const sorted = sortCategories(input);
    expect(sorted.map((c) => c.id)).toEqual(["c3", "c2", "c1"]);
    expect(input.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/features/seller/tests/unit/catalog-model.test.ts`
Expected: FAIL — cannot resolve `../../lib/catalog-model`.

- [ ] **Step 3: Implement**

Create `src/features/seller/lib/catalog-model.ts`:

```typescript
/**
 * Pure helpers for the seller catalog grid: grouping, filtering, sorting.
 */

import type { Category, Product, ProductVariant } from "../types";

export type CatalogProduct = Product & {
  variants: ProductVariant[];
  category?: Category | null;
};

export function filterByCategory(
  products: CatalogProduct[],
  categoryId: string | null,
): CatalogProduct[] {
  if (categoryId === null) return products;
  return products.filter((p) => p.category_id === categoryId);
}

export function countByCategory(products: CatalogProduct[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of products) {
    counts.set(p.category_id, (counts.get(p.category_id) ?? 0) + 1);
  }
  return counts;
}

export function sortCategories(categories: Category[]): Category[] {
  return [...categories].sort(
    (a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/features/seller/tests/unit/catalog-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/seller/lib/catalog-model.ts src/features/seller/tests/unit/catalog-model.test.ts
git commit -m "feat(seller): catalog grid model helpers"
```

---

### Task 4: Seller server-action fixes

**Files:**
- Modify: `src/features/seller/server/actions.ts`

**Interfaces:**
- Produces (used by Tasks 6–8): every mutation gains an OPTIONAL trailing `orgSlug?: string` used for real revalidation. Existing callers keep compiling; new UI (Tasks 6–8) always passes it. Signatures after this task:
  - `createCategory(orgId, input, orgSlug?)`, `updateCategory(id, input, orgSlug?)`, `deleteCategory(id, orgSlug?)`
  - `createProduct(orgId, input, orgSlug?)`, `updateProduct(id, input, orgSlug?)`, `deleteProduct(id, orgSlug?)`
  - `createVariant(orgId, input, orgSlug?)`, `updateVariant(id, input, orgSlug?)`, `deleteVariant(id, orgSlug?)`
  - `requireSellerRole(orgSlug)` now checks the CURRENT user's membership.
  - `getProducts(orgId)` no longer filters `is_active` (seller page must manage inactive products too).

- [ ] **Step 1: Fix `requireSellerRole`**

Replace the existing function (lines 30–42) with:

```typescript
export async function requireSellerRole(orgSlug: string): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const orgId = await getOrganizationId(orgSlug);
  if (!orgId) return false;

  const { data: member } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  return !!member && ["owner", "org_admin", "seller"].includes(member.role);
}
```

- [ ] **Step 2: Add a revalidation helper and fix category actions**

Add below `requireSellerRole`:

```typescript
function revalidateSellerPath(orgSlug: string | undefined, page: string) {
  if (orgSlug) revalidatePath(`/${orgSlug}/${page}`);
}
```

Replace the three category mutations:

```typescript
export async function createCategory(
  orgId: string,
  input: Omit<CategoryInsert, "organization_id">,
  orgSlug?: string,
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .insert({ ...input, organization_id: orgId })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidateSellerPath(orgSlug, "products");
  return data;
}

export async function updateCategory(id: string, input: CategoryUpdate, orgSlug?: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidateSellerPath(orgSlug, "products");
  return data;
}

export async function deleteCategory(id: string, orgSlug?: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      throw new Error("This category still has products. Move or delete them first.");
    }
    throw new Error(error.message);
  }
  revalidateSellerPath(orgSlug, "products");
}
```

- [ ] **Step 3: Same treatment for products and variants**

Replace `getProducts`, product mutations, and variant mutations:

```typescript
export async function getProducts(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("*, category:categories(*), variants:product_variants(*)")
    .eq("organization_id", orgId)
    .order("name");
  return data ?? [];
}

export async function createProduct(
  orgId: string,
  input: Omit<ProductInsert, "organization_id">,
  orgSlug?: string,
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .insert({ ...input, organization_id: orgId })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidateSellerPath(orgSlug, "products");
  return data;
}

export async function updateProduct(id: string, input: ProductUpdate, orgSlug?: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidateSellerPath(orgSlug, "products");
  return data;
}

export async function deleteProduct(id: string, orgSlug?: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      throw new Error("This product has been ordered before and cannot be deleted. Mark it inactive instead.");
    }
    throw new Error(error.message);
  }
  revalidateSellerPath(orgSlug, "products");
}

export async function createVariant(
  orgId: string,
  input: Omit<ProductVariantInsert, "organization_id">,
  orgSlug?: string,
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_variants")
    .insert({ ...input, organization_id: orgId })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidateSellerPath(orgSlug, "products");
  return data;
}

export async function updateVariant(id: string, input: ProductVariantUpdate, orgSlug?: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_variants")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidateSellerPath(orgSlug, "products");
  return data;
}

export async function deleteVariant(id: string, orgSlug?: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("product_variants").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      throw new Error("This size/option has been ordered before and cannot be deleted. Mark it unavailable instead.");
    }
    throw new Error(error.message);
  }
  revalidateSellerPath(orgSlug, "products");
}
```

Also update `createCustomer`/`updateCustomer`/`deleteCustomer` the same way: add trailing `orgSlug?: string` and replace `revalidatePath(\`/[organizationSlug]/customers\`)` with `revalidateSellerPath(orgSlug, "customers")`. In `createOrder` and `updateOrderStatus`, add trailing `orgSlug?: string` and replace the literal `revalidatePath` calls with `revalidateSellerPath(orgSlug, "orders")` (and for `updateOrderStatus` also `revalidateSellerPath(orgSlug, \`orders/${orderId}\`)`).

- [ ] **Step 4: Type check and tests**

Run: `npx tsc --noEmit && npm test`
Expected: PASS — trailing optional params keep existing callers compiling.

- [ ] **Step 5: Commit**

```bash
git add src/features/seller/server/actions.ts
git commit -m "fix(seller): requireSellerRole user filter, real revalidation, friendly FK delete errors"
```

---

### Task 5: Image upload infrastructure

**Files:**
- Modify: `next.config.mjs` (or `.js` — whichever exists at repo root) `images.remotePatterns`
- Create: `src/features/seller/components/products/image-upload.tsx`

**Interfaces:**
- Consumes: `createSupabaseBrowserClient` from `@/lib/supabase/client`; bucket `product-images` (Task 1).
- Produces (used by Task 6): `<ImageUpload organizationId={string} value={string | null} onChange={(url: string | null) => void} />` — uploads to `product-images/{organizationId}/{uuid}.{ext}`, calls `onChange` with the public URL; shows preview and inline errors; never throws.

- [ ] **Step 1: Allow Supabase Storage hosts for next/image**

In the next config `images.remotePatterns`, extend to:

```javascript
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        // Hosted Supabase Storage public URLs
        protocol: "https",
        hostname: "**.supabase.co",
      },
      {
        // Local Supabase (supabase start) storage URLs
        protocol: "http",
        hostname: "127.0.0.1",
      },
      {
        protocol: "http",
        hostname: "localhost",
      },
    ],
  },
```

- [ ] **Step 2: Create the ImageUpload component**

Create `src/features/seller/components/products/image-upload.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const MAX_SIZE_BYTES = 5 * 1024 * 1024;

type ImageUploadProps = {
  organizationId: string;
  value: string | null;
  onChange: (url: string | null) => void;
};

export function ImageUpload({ organizationId, value, onChange }: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError("Image must be under 5 MB.");
      return;
    }
    setUploading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${organizationId}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("product-images")
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (uploadError) throw new Error(uploadError.message);
      const { data } = supabase.storage.from("product-images").getPublicUrl(path);
      onChange(data.publicUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      {value ? (
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md border bg-muted">
          <Image src={value} alt="Product image" fill className="object-cover" />
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="absolute right-2 top-2 h-7 w-7"
            onClick={() => onChange(null)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/50 text-muted-foreground hover:bg-muted"
        >
          {uploading ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <>
              <ImagePlus className="h-6 w-6" />
              <span className="text-sm">Upload photo</span>
            </>
          )}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add next.config.* src/features/seller/components/products/image-upload.tsx
git commit -m "feat(seller): product image upload component + next/image storage hosts"
```

---

### Task 6: Catalog dialogs (category, product, variant)

**Files:**
- Create: `src/features/seller/components/products/category-dialog.tsx`
- Create: `src/features/seller/components/products/product-dialog.tsx`
- Create: `src/features/seller/components/products/variant-dialog.tsx`

**Interfaces:**
- Consumes: server actions (Task 4 signatures), `ImageUpload` (Task 5), `UNIT_TYPES`/`UNIT_TYPE_LABELS`/`UnitType` (Task 1), `useToast` from `@/hooks/use-toast`, ui `Dialog`/`Input`/`Label`/`Textarea`/`Button`/`Select`.
- Produces (used by Task 7):
  - `<CategoryDialog open onOpenChange organizationId organizationSlug category? onSaved(category: Category) />`
  - `<ProductDialog open onOpenChange organizationId organizationSlug categories defaultCategoryId? product? onSaved(product: Product) />`
  - `<VariantDialog open onOpenChange organizationId organizationSlug productId variant? onSaved(variant: ProductVariant) />`
  - Each dialog performs its own server-action call (create when the entity prop is absent, update when present), toasts on error, and calls `onSaved` with the returned row.

- [ ] **Step 1: Category dialog**

Create `src/features/seller/components/products/category-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { createCategory, updateCategory } from "@/features/seller/server/actions";
import type { Category } from "@/features/seller/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type CategoryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  organizationSlug: string;
  category?: Category;
  onSaved: (category: Category) => void;
};

export function CategoryDialog({
  open,
  onOpenChange,
  organizationId,
  organizationSlug,
  category,
  onSaved,
}: CategoryDialogProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (data: FormData) => {
    setSaving(true);
    try {
      const input = {
        name: data.get("name") as string,
        description: (data.get("description") as string) || null,
        display_order: Number(data.get("display_order")) || 0,
      };
      const saved = category
        ? await updateCategory(category.id, input, organizationSlug)
        : await createCategory(organizationId, { ...input, is_active: true }, organizationSlug);
      onSaved(saved);
      onOpenChange(false);
      toast({ title: category ? "Category updated" : "Category created" });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{category ? "Edit Category" : "Add Category"}</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="category-name">Category Name</Label>
            <Input id="category-name" name="name" defaultValue={category?.name ?? ""} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="category-description">Description</Label>
            <Textarea
              id="category-description"
              name="description"
              defaultValue={category?.description ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="category-display-order">Display Order</Label>
            <Input
              id="category-display-order"
              name="display_order"
              type="number"
              defaultValue={category?.display_order ?? 0}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {category ? "Save Changes" : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Product dialog (with image upload)**

Create `src/features/seller/components/products/product-dialog.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { createProduct, updateProduct } from "@/features/seller/server/actions";
import type { Category, Product } from "@/features/seller/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ImageUpload } from "./image-upload";

type ProductDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  organizationSlug: string;
  categories: Category[];
  defaultCategoryId?: string;
  product?: Product;
  onSaved: (product: Product) => void;
};

export function ProductDialog({
  open,
  onOpenChange,
  organizationId,
  organizationSlug,
  categories,
  defaultCategoryId,
  product,
  onSaved,
}: ProductDialogProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(product?.image_url ?? null);
  const [categoryId, setCategoryId] = useState<string>(
    product?.category_id ?? defaultCategoryId ?? "",
  );

  // Re-sync when the dialog opens for a different product.
  useEffect(() => {
    if (open) {
      setImageUrl(product?.image_url ?? null);
      setCategoryId(product?.category_id ?? defaultCategoryId ?? "");
    }
  }, [open, product, defaultCategoryId]);

  const handleSubmit = async (data: FormData) => {
    if (!categoryId) {
      toast({ title: "Please choose a category", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const input = {
        name: data.get("name") as string,
        description: (data.get("description") as string) || null,
        category_id: categoryId,
        image_url: imageUrl,
      };
      const saved = product
        ? await updateProduct(product.id, input, organizationSlug)
        : await createProduct(organizationId, { ...input, is_active: true }, organizationSlug);
      onSaved(saved);
      onOpenChange(false);
      toast({ title: product ? "Product updated" : "Product created" });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{product ? "Edit Product" : "Add Product"}</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Photo</Label>
            <ImageUpload organizationId={organizationId} value={imageUrl} onChange={setImageUrl} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="product-name">Product Name</Label>
            <Input id="product-name" name="name" defaultValue={product?.name ?? ""} required />
          </div>
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="product-description">Description</Label>
            <Textarea
              id="product-description"
              name="description"
              defaultValue={product?.description ?? ""}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {product ? "Save Changes" : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Variant dialog (with unit selector)**

Create `src/features/seller/components/products/variant-dialog.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { createVariant, updateVariant } from "@/features/seller/server/actions";
import {
  UNIT_TYPE_LABELS,
  UNIT_TYPES,
  type ProductVariant,
  type UnitType,
} from "@/features/seller/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

type VariantDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  organizationSlug: string;
  productId: string;
  variant?: ProductVariant;
  onSaved: (variant: ProductVariant) => void;
};

export function VariantDialog({
  open,
  onOpenChange,
  organizationId,
  organizationSlug,
  productId,
  variant,
  onSaved,
}: VariantDialogProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [unitType, setUnitType] = useState<UnitType>(
    (variant?.unit_type as UnitType) ?? "per_piece",
  );
  const [available, setAvailable] = useState(variant?.is_available ?? true);

  useEffect(() => {
    if (open) {
      setUnitType((variant?.unit_type as UnitType) ?? "per_piece");
      setAvailable(variant?.is_available ?? true);
    }
  }, [open, variant]);

  const priceLabel = unitType === "per_kg" ? "Price (RM per kg)" : "Price (RM per piece)";

  const handleSubmit = async (data: FormData) => {
    setSaving(true);
    try {
      const input = {
        name: data.get("name") as string,
        price_per_unit: Number(data.get("price_per_unit")),
        unit_type: unitType,
        is_available: available,
      };
      const saved = variant
        ? await updateVariant(variant.id, input, organizationSlug)
        : await createVariant(organizationId, { ...input, product_id: productId }, organizationSlug);
      onSaved(saved);
      onOpenChange(false);
      toast({ title: variant ? "Size/option updated" : "Size/option created" });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{variant ? "Edit Size/Option" : "Add Size/Option"}</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="variant-name">Name (e.g., Standard, Small, 1kg Pack)</Label>
            <Input id="variant-name" name="name" defaultValue={variant?.name ?? ""} required />
          </div>
          <div className="space-y-2">
            <Label>Sold by</Label>
            <Select value={unitType} onValueChange={(v) => setUnitType(v as UnitType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNIT_TYPES.map((u) => (
                  <SelectItem key={u} value={u}>
                    {UNIT_TYPE_LABELS[u]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="variant-price">{priceLabel}</Label>
            <Input
              id="variant-price"
              name="price_per_unit"
              type="number"
              step="0.01"
              min="0"
              defaultValue={variant?.price_per_unit ?? ""}
              required
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="variant-available"
              type="checkbox"
              checked={available}
              onChange={(e) => setAvailable(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="variant-available">Available for ordering</Label>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {variant ? "Save Changes" : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/seller/components/products/
git commit -m "feat(seller): catalog dialogs with image upload and unit selector"
```

---

### Task 7: Products page card grid

**Files:**
- Create: `src/features/seller/components/products/product-card.tsx`
- Create: `src/features/seller/components/products/product-catalog.tsx`
- Rewrite: `src/app/(seller)/[organizationSlug]/products/products-client.tsx`
- Modify: `src/app/(seller)/[organizationSlug]/products/page.tsx`

**Interfaces:**
- Consumes: dialogs (Task 6), `CatalogProduct`/`filterByCategory`/`countByCategory`/`sortCategories` (Task 3), `formatVariantPrice` (Task 2), server delete actions (Task 4).
- Produces: `ProductsClient` props change to `{ organizationId: string; organizationSlug: string; initialCategories: Category[]; initialProducts: CatalogProduct[] }`.

- [ ] **Step 1: Seller product card**

Create `src/features/seller/components/products/product-card.tsx`:

```tsx
"use client";

import Image from "next/image";
import { ImageOff, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import type { ProductVariant, UnitType } from "@/features/seller/types";
import type { CatalogProduct } from "@/features/seller/lib/catalog-model";
import { formatVariantPrice } from "@/features/seller/lib/pricing";

type SellerProductCardProps = {
  product: CatalogProduct;
  onEdit: () => void;
  onDelete: () => void;
  onAddVariant: () => void;
  onEditVariant: (variant: ProductVariant) => void;
  onDeleteVariant: (variant: ProductVariant) => void;
};

export function SellerProductCard({
  product,
  onEdit,
  onDelete,
  onAddVariant,
  onEditVariant,
  onDeleteVariant,
}: SellerProductCardProps) {
  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="relative aspect-[4/3] bg-muted">
        {product.image_url ? (
          <Image src={product.image_url} alt={product.name} fill className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-10 w-10" />
          </div>
        )}
        {!product.is_active && (
          <span className="absolute left-2 top-2 rounded-full bg-gray-900/80 px-2 py-0.5 text-xs text-white">
            Inactive
          </span>
        )}
      </div>
      <CardHeader className="p-4 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-semibold leading-tight">{product.name}</h3>
            {product.description && (
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                {product.description}
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onDelete}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 p-4 pt-0">
        {product.variants.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sizes/prices yet.</p>
        ) : (
          <ul className="space-y-1">
            {product.variants.map((variant) => (
              <li key={variant.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      variant.is_available ? "bg-green-500" : "bg-gray-300"
                    }`}
                  />
                  <span className="truncate">{variant.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="font-medium">
                    {formatVariantPrice(
                      Number(variant.price_per_unit),
                      variant.unit_type as UnitType,
                    )}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => onEditVariant(variant)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => onDeleteVariant(variant)}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <CardFooter className="p-4 pt-0">
        <Button variant="outline" size="sm" className="w-full" onClick={onAddVariant}>
          <Plus className="mr-2 h-4 w-4" />
          Add Size/Option
        </Button>
      </CardFooter>
    </Card>
  );
}
```

- [ ] **Step 2: Catalog (chips + grid)**

Create `src/features/seller/components/products/product-catalog.tsx`:

```tsx
"use client";

import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Category, ProductVariant } from "@/features/seller/types";
import {
  countByCategory,
  filterByCategory,
  sortCategories,
  type CatalogProduct,
} from "@/features/seller/lib/catalog-model";
import { SellerProductCard } from "./product-card";

type ProductCatalogProps = {
  categories: Category[];
  products: CatalogProduct[];
  selectedCategoryId: string | null;
  onSelectCategory: (categoryId: string | null) => void;
  onEditCategory: (category: Category) => void;
  onDeleteCategory: (category: Category) => void;
  onEditProduct: (product: CatalogProduct) => void;
  onDeleteProduct: (product: CatalogProduct) => void;
  onAddVariant: (product: CatalogProduct) => void;
  onEditVariant: (product: CatalogProduct, variant: ProductVariant) => void;
  onDeleteVariant: (product: CatalogProduct, variant: ProductVariant) => void;
};

export function ProductCatalog({
  categories,
  products,
  selectedCategoryId,
  onSelectCategory,
  onEditCategory,
  onDeleteCategory,
  onEditProduct,
  onDeleteProduct,
  onAddVariant,
  onEditVariant,
  onDeleteVariant,
}: ProductCatalogProps) {
  const sorted = sortCategories(categories);
  const counts = countByCategory(products);
  const visible = filterByCategory(products, selectedCategoryId);
  const selected = sorted.find((c) => c.id === selectedCategoryId) ?? null;

  return (
    <div className="space-y-4">
      {/* Category chips */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={selectedCategoryId === null ? "default" : "outline"}
          size="sm"
          onClick={() => onSelectCategory(null)}
        >
          All ({products.length})
        </Button>
        {sorted.map((category) => (
          <Button
            key={category.id}
            variant={selectedCategoryId === category.id ? "default" : "outline"}
            size="sm"
            onClick={() => onSelectCategory(category.id)}
          >
            {category.name} ({counts.get(category.id) ?? 0})
          </Button>
        ))}
      </div>

      {/* Selected-category actions */}
      {selected && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>
            {selected.name}
            {selected.description ? ` — ${selected.description}` : ""}
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEditCategory(selected)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onDeleteCategory(selected)}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      )}

      {/* Grid */}
      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          {categories.length === 0
            ? "Create your first category, then add products to it."
            : "No products in this category yet. Click “Add Product” to create one."}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((product) => (
            <SellerProductCard
              key={product.id}
              product={product}
              onEdit={() => onEditProduct(product)}
              onDelete={() => onDeleteProduct(product)}
              onAddVariant={() => onAddVariant(product)}
              onEditVariant={(variant) => onEditVariant(product, variant)}
              onDeleteVariant={(variant) => onDeleteVariant(product, variant)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Rewrite the products client**

Replace the ENTIRE contents of `src/app/(seller)/[organizationSlug]/products/products-client.tsx` with:

```tsx
"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import {
  deleteCategory,
  deleteProduct,
  deleteVariant,
} from "@/features/seller/server/actions";
import type { Category, Product, ProductVariant } from "@/features/seller/types";
import type { CatalogProduct } from "@/features/seller/lib/catalog-model";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { CategoryDialog } from "@/features/seller/components/products/category-dialog";
import { ProductDialog } from "@/features/seller/components/products/product-dialog";
import { VariantDialog } from "@/features/seller/components/products/variant-dialog";
import { ProductCatalog } from "@/features/seller/components/products/product-catalog";

type DialogState =
  | { kind: "category"; category?: Category }
  | { kind: "product"; product?: CatalogProduct; defaultCategoryId?: string }
  | { kind: "variant"; productId: string; variant?: ProductVariant }
  | null;

type ProductsClientProps = {
  organizationId: string;
  organizationSlug: string;
  initialCategories: Category[];
  initialProducts: CatalogProduct[];
};

export function ProductsClient({
  organizationId,
  organizationSlug,
  initialCategories,
  initialProducts,
}: ProductsClientProps) {
  const { toast } = useToast();
  const [categories, setCategories] = useState(initialCategories);
  const [products, setProducts] = useState(initialProducts);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);

  const closeDialog = (open: boolean) => {
    if (!open) setDialog(null);
  };

  const handleCategorySaved = (saved: Category) => {
    setCategories((prev) =>
      prev.some((c) => c.id === saved.id)
        ? prev.map((c) => (c.id === saved.id ? saved : c))
        : [...prev, saved],
    );
  };

  const handleProductSaved = (saved: Product) => {
    setProducts((prev) => {
      const existing = prev.find((p) => p.id === saved.id);
      const category = categories.find((c) => c.id === saved.category_id) ?? null;
      if (existing) {
        return prev.map((p) => (p.id === saved.id ? { ...p, ...saved, category } : p));
      }
      return [...prev, { ...saved, variants: [], category }];
    });
  };

  const handleVariantSaved = (saved: ProductVariant) => {
    setProducts((prev) =>
      prev.map((p) => {
        if (p.id !== saved.product_id) return p;
        const exists = p.variants.some((v) => v.id === saved.id);
        return {
          ...p,
          variants: exists
            ? p.variants.map((v) => (v.id === saved.id ? saved : v))
            : [...p.variants, saved],
        };
      }),
    );
  };

  const handleDeleteCategory = async (category: Category) => {
    if (!confirm(`Delete category "${category.name}"?`)) return;
    try {
      await deleteCategory(category.id, organizationSlug);
      setCategories((prev) => prev.filter((c) => c.id !== category.id));
      if (selectedCategoryId === category.id) setSelectedCategoryId(null);
      toast({ title: "Category deleted" });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  const handleDeleteProduct = async (product: CatalogProduct) => {
    if (!confirm(`Delete product "${product.name}"?`)) return;
    try {
      await deleteProduct(product.id, organizationSlug);
      setProducts((prev) => prev.filter((p) => p.id !== product.id));
      toast({ title: "Product deleted" });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  const handleDeleteVariant = async (product: CatalogProduct, variant: ProductVariant) => {
    if (!confirm(`Delete "${variant.name}" from ${product.name}?`)) return;
    try {
      await deleteVariant(variant.id, organizationSlug);
      setProducts((prev) =>
        prev.map((p) =>
          p.id === product.id
            ? { ...p, variants: p.variants.filter((v) => v.id !== variant.id) }
            : p,
        ),
      );
      toast({ title: "Size/option deleted" });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Products &amp; Catalog</h1>
          <p className="text-muted-foreground">Manage categories, products, and pricing</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setDialog({ kind: "category" })}>
            <Plus className="mr-2 h-4 w-4" />
            Add Category
          </Button>
          <Button
            onClick={() =>
              setDialog({ kind: "product", defaultCategoryId: selectedCategoryId ?? undefined })
            }
            disabled={categories.length === 0}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Product
          </Button>
        </div>
      </div>

      <ProductCatalog
        categories={categories}
        products={products}
        selectedCategoryId={selectedCategoryId}
        onSelectCategory={setSelectedCategoryId}
        onEditCategory={(category) => setDialog({ kind: "category", category })}
        onDeleteCategory={handleDeleteCategory}
        onEditProduct={(product) => setDialog({ kind: "product", product })}
        onDeleteProduct={handleDeleteProduct}
        onAddVariant={(product) => setDialog({ kind: "variant", productId: product.id })}
        onEditVariant={(product, variant) =>
          setDialog({ kind: "variant", productId: product.id, variant })
        }
        onDeleteVariant={handleDeleteVariant}
      />

      <CategoryDialog
        open={dialog?.kind === "category"}
        onOpenChange={closeDialog}
        organizationId={organizationId}
        organizationSlug={organizationSlug}
        category={dialog?.kind === "category" ? dialog.category : undefined}
        onSaved={handleCategorySaved}
      />
      <ProductDialog
        open={dialog?.kind === "product"}
        onOpenChange={closeDialog}
        organizationId={organizationId}
        organizationSlug={organizationSlug}
        categories={categories}
        defaultCategoryId={dialog?.kind === "product" ? dialog.defaultCategoryId : undefined}
        product={dialog?.kind === "product" ? (dialog.product as Product | undefined) : undefined}
        onSaved={handleProductSaved}
      />
      <VariantDialog
        open={dialog?.kind === "variant"}
        onOpenChange={closeDialog}
        organizationId={organizationId}
        organizationSlug={organizationSlug}
        productId={dialog?.kind === "variant" ? dialog.productId : ""}
        variant={dialog?.kind === "variant" ? dialog.variant : undefined}
        onSaved={handleVariantSaved}
      />
    </div>
  );
}
```

- [ ] **Step 4: Pass organizationId from the page**

Replace the `return` in `src/app/(seller)/[organizationSlug]/products/page.tsx`:

```tsx
  return (
    <ProductsClient
      organizationId={org.id}
      organizationSlug={organizationSlug}
      initialCategories={categories}
      initialProducts={products}
    />
  );
```

- [ ] **Step 5: Type check and tests**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 6: Manual smoke test**

Start the dev stack (`START-PROJECT.command` or `npm run dev` with Supabase running), sign in as a seller/org_admin, open `/{org-slug}/products`, and verify: create category → chip appears; create product with photo → card with image; add per-kg variant → shows `RM 12.00 /kg`; add per-piece variant → shows `RM 25.00 each`; delete variant/product/category all work; deleting a category that still has products shows the friendly error.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(seller)/[organizationSlug]/products/" src/features/seller/components/products/
git commit -m "feat(seller): card-grid products page, fixes org-id bug and broken deletes"
```

---

### Task 8: Unit-aware New Order flow

**Files:**
- Modify: `src/app/(seller)/[organizationSlug]/orders/new/new-order-client.tsx`

**Interfaces:**
- Consumes: `formatVariantPrice`, `formatQuantity`, `lineSubtotal`, `isValidQuantity` (Task 2); `UnitType` (Task 1); `unit_type` now present on variants returned by `getCatalogForOrdering`.
- Produces: order items created with decimal quantities for per-kg lines.

- [ ] **Step 1: Update local types and imports**

In `new-order-client.tsx`, add to the imports:

```tsx
import type { Customer, UnitType } from "@/features/seller/types";
import {
  formatPrice,
  formatQuantity,
  formatVariantPrice,
  isValidQuantity,
  lineSubtotal,
} from "@/features/seller/lib/pricing";
```

Extend the existing lucide-react import to include `Minus` (it already imports `Plus`, `Search`, `ShoppingCart`, `Trash2`). Remove the `ORDER_STATUS_LABELS`/`OrderStatus` imports if unused, and DELETE the local `formatPrice` function — use the imported one.

Update the catalog and cart types:

```tsx
type CategoryWithProducts = {
  id: string;
  name: string;
  products: {
    id: string;
    name: string;
    variants: {
      id: string;
      name: string;
      price_per_unit: number;
      unit_type: string;
      is_available: boolean;
    }[];
  }[];
}[];

type CartItem = {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  price: number;
  unitType: UnitType;
  quantity: number;
};
```

- [ ] **Step 2: Unit-aware cart mutations**

Replace `addToCart` and `updateQuantity`:

```tsx
  const addToCart = (
    variantId: string,
    productId: string,
    productName: string,
    variantName: string,
    price: number,
    unitType: UnitType,
  ) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.variantId === variantId);
      if (existing) {
        return prev.map((item) =>
          item.variantId === variantId ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }
      return [...prev, { variantId, productId, productName, variantName, price, unitType, quantity: 1 }];
    });
  };

  const updateQuantity = (variantId: string, quantity: number) => {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setCart((prev) => prev.filter((item) => item.variantId !== variantId));
    } else {
      setCart((prev) =>
        prev.map((item) => (item.variantId === variantId ? { ...item, quantity } : item)),
      );
    }
  };
```

Replace the `cartTotal` line:

```tsx
  const cartTotal = cart.reduce((sum, item) => sum + lineSubtotal(item.price, item.quantity), 0);
```

- [ ] **Step 3: Pass unit_type from the catalog buttons**

In the catalog rendering, replace the variant `<Button>`'s `onClick` and label:

```tsx
                            <Button
                              key={variant.id}
                              variant="outline"
                              size="sm"
                              disabled={!variant.is_available}
                              onClick={() =>
                                addToCart(
                                  variant.id,
                                  product.id,
                                  product.name,
                                  variant.name,
                                  variant.price_per_unit,
                                  variant.unit_type as UnitType,
                                )
                              }
                            >
                              {variant.name} —{" "}
                              {formatVariantPrice(variant.price_per_unit, variant.unit_type as UnitType)}
                            </Button>
```

- [ ] **Step 4: Editable, unit-aware quantities in the cart**

Replace the cart item rendering block (the `cart.map(...)` inside "Order Summary") with:

```tsx
                {cart.map((item) => {
                  const step = item.unitType === "per_kg" ? 0.5 : 1;
                  const min = item.unitType === "per_kg" ? 0.1 : 1;
                  return (
                    <div key={item.variantId} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{item.productName}</div>
                          <div className="text-sm text-muted-foreground">
                            {item.variantName} · {formatVariantPrice(item.price, item.unitType)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="font-medium">
                            {formatPrice(lineSubtotal(item.price, item.quantity))}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => removeFromCart(item.variantId)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() =>
                            updateQuantity(
                              item.variantId,
                              Math.round((item.quantity - step) * 1000) / 1000,
                            )
                          }
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <Input
                          type="number"
                          inputMode="decimal"
                          step={step}
                          min={min}
                          value={item.quantity}
                          onChange={(e) => updateQuantity(item.variantId, Number(e.target.value))}
                          className="h-7 w-20 text-center"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() =>
                            updateQuantity(
                              item.variantId,
                              Math.round((item.quantity + step) * 1000) / 1000,
                            )
                          }
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                        <span className="ml-1 text-sm text-muted-foreground">
                          {item.unitType === "per_kg" ? "kg" : "pcs"}
                        </span>
                      </div>
                    </div>
                  );
                })}
```

- [ ] **Step 5: Validate quantities on submit**

At the top of `submitOrder`, after the empty-cart check, add:

```tsx
    const invalid = cart.find((item) => !isValidQuantity(item.quantity, item.unitType));
    if (invalid) {
      toast({
        title: `Invalid quantity for ${invalid.productName} (${invalid.variantName})`,
        description:
          invalid.unitType === "per_piece"
            ? "Piece quantities must be whole numbers."
            : "Weight must be greater than zero.",
        variant: "destructive",
      });
      return;
    }
```

And in the `createOrder(...)` call, replace the items mapping subtotal:

```tsx
        cart.map((item) => ({
          variant_id: item.variantId,
          quantity: item.quantity,
          unit_price: item.price,
          subtotal: lineSubtotal(item.price, item.quantity),
        })),
```

Also pass the slug for revalidation: per Task 4, `createOrder`'s signature is `createOrder(orgId, orderInput, items, orgSlug?)` — add `organizationSlug` as the fourth argument to this call.

- [ ] **Step 6: Type check, tests, manual check**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.
Manual: create an order with 1.5 kg of a per-kg variant and 2 pcs of a per-piece variant; totals must equal `1.5 × price + 2 × price`; the DB row for the kg line must show `quantity = 1.500`.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(seller)/[organizationSlug]/orders/new/new-order-client.tsx"
git commit -m "feat(seller): unit-aware quantities in new-order flow"
```

---

### Task 9: Unit display on order detail

**Files:**
- Modify: `src/app/(seller)/[organizationSlug]/orders/[orderId]/order-detail-client.tsx`

**Interfaces:**
- Consumes: `formatQuantity`, `formatVariantPrice` (Task 2), `UnitType` (Task 1). `getOrderWithItems` already selects `variant:product_variants(*)`, so `unit_type` flows automatically.

- [ ] **Step 1: Update the item lines**

Add imports:

```tsx
import { formatQuantity, formatVariantPrice } from "@/features/seller/lib/pricing";
import type { UnitType } from "@/features/seller/types";
```

Replace the two display lines inside `order.items.map` (currently `…x {item.quantity}` and `…{formatPrice(Number(item.unit_price))} each`):

```tsx
                    <div className="text-sm text-muted-foreground">
                      {item.variant?.name || "Unknown Variant"} ·{" "}
                      {formatQuantity(
                        Number(item.quantity),
                        (item.variant?.unit_type ?? "per_piece") as UnitType,
                      )}
                    </div>
```

```tsx
                    <div className="text-sm text-muted-foreground">
                      {formatVariantPrice(
                        Number(item.unit_price),
                        (item.variant?.unit_type ?? "per_piece") as UnitType,
                      )}
                    </div>
```

- [ ] **Step 2: Type check, commit**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

```bash
git add "src/app/(seller)/[organizationSlug]/orders/[orderId]/order-detail-client.tsx"
git commit -m "feat(seller): unit-aware quantity display on order detail"
```

---

### Task 10: Buyer portal minimal ripple

**Files:**
- Modify: `src/features/buyer/types.ts`
- Modify: `src/features/buyer/server/actions.ts`
- Modify: `src/features/buyer/components/product-card.tsx`
- Modify: `src/app/buyer_portal/[organizationSlug]/cart/page.tsx`
- Modify: `src/app/buyer_portal/[organizationSlug]/checkout/page.tsx`

**Interfaces:**
- Consumes: `unit_type` column (Task 1). The cart API (`/api/buyer/cart`) selects `*` so `unit_type` already flows.
- Produces: buyer orders with decimal kg quantities; unit-labelled prices.

- [ ] **Step 1: Buyer types**

In `src/features/buyer/types.ts`, add `unit_type` to `ProductVariant`:

```typescript
export type ProductVariant = {
  id: string;
  organization_id: string;
  product_id: string;
  name: string;
  price_per_unit: number;
  unit_type: "per_kg" | "per_piece";
  is_available: boolean;
};
```

And relax `CartItemSchema` (decimal kg quantities; per-piece integrality is enforced server-side against the variant):

```typescript
export const CartItemSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.number().positive(),
});
```

- [ ] **Step 2: Server-side validation in `createBuyerOrder`**

In `src/features/buyer/server/actions.ts`:

In `CreateOrderInput`, change `quantity: z.number().int().positive()` to `quantity: z.number().positive()`.

In the variant fetch, add `unit_type`:

```typescript
  const { data: variants } = await supabase
    .from("product_variants")
    .select("id, price_per_unit, unit_type, product_id, is_available")
    .in("id", variantIds);
```

In the totals loop, after the availability check, add the per-piece integer guard and round the subtotal:

```typescript
  for (const item of input.items) {
    const variant = variantMap.get(item.variantId);
    if (!variant || !variant.is_available) {
      return err("validation", `Product is not available`);
    }
    if (variant.unit_type === "per_piece" && !Number.isInteger(item.quantity)) {
      return err("validation", "Piece quantities must be whole numbers");
    }
    const subtotal = Math.round(Number(variant.price_per_unit) * item.quantity * 100) / 100;
    totalAmount += subtotal;
    orderItems.push({
      variant_id: variant.id,
      quantity: item.quantity,
      unit_price: variant.price_per_unit,
      subtotal,
    });
  }
```

- [ ] **Step 3: Buyer product card**

In `src/features/buyer/components/product-card.tsx`:

Price display — replace the price `<span>`:

```tsx
              <span className="text-lg font-bold">
                {formatPrice(Number(selectedVariant.price_per_unit))}
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  {selectedVariant.unit_type === "per_kg" ? "/kg" : "each"}
                </span>
              </span>
```

Quantity control — replace the quantity `<Select>` block in `CardFooter` with a unit-aware control (add `import { Input } from "@/components/ui/input";`):

```tsx
            {selectedVariant?.unit_type === "per_kg" ? (
              <div className="flex w-28 items-center gap-1">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0.5}
                  step={0.5}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(0.5, Number(e.target.value) || 0.5))}
                  className="text-center"
                />
                <span className="text-sm text-muted-foreground">kg</span>
              </div>
            ) : (
              <Select
                value={quantity.toString()}
                onValueChange={(v) => setQuantity(parseInt(v, 10))}
              >
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                    <SelectItem key={n} value={n.toString()}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
```

Also reset quantity when the variant changes — update the variant `Select`'s `onValueChange`:

```tsx
            <Select
              value={selectedVariantId}
              onValueChange={(id) => {
                setSelectedVariantId(id);
                setQuantity(1);
              }}
            >
```

- [ ] **Step 4: Buyer cart page**

In `src/app/buyer_portal/[organizationSlug]/cart/page.tsx`:

Add `unitType` to `CartItemWithDetails` and the mapping:

```tsx
type CartItemWithDetails = {
  variantId: string;
  quantity: number;
  name: string;
  price: number;
  unitType: "per_kg" | "per_piece";
  productName: string;
};
```

```tsx
        setCartItems(
          data.variants.map((v: any) => ({
            variantId: v.id,
            quantity: itemsMap.get(v.id) || 1,
            name: v.name,
            price: Number(v.price_per_unit),
            unitType: v.unit_type === "per_kg" ? "per_kg" : "per_piece",
            productName: v.product?.name || "Unknown Product",
          })),
        );
```

Make the +/- buttons and quantity display unit-aware — in the cart line controls, compute `const step = item.unitType === "per_kg" ? 0.5 : 1;` and change:
- minus button: `updateQuantity(item.variantId, Math.round((item.quantity - step) * 1000) / 1000)`
- quantity display: `<span className="w-14 text-center">{item.unitType === "per_kg" ? `${item.quantity} kg` : item.quantity}</span>`
- plus button: `updateQuantity(item.variantId, Math.round((item.quantity + step) * 1000) / 1000)`

- [ ] **Step 5: Buyer checkout page**

In `src/app/buyer_portal/[organizationSlug]/checkout/page.tsx`, mirror Step 4's type/mapping change (`unitType` on the local cart item type, mapped from `v.unit_type`), and update the summary line (currently `{item.productName} - {item.name} x {item.quantity}`):

```tsx
                      {item.productName} - {item.name} ×{" "}
                      {item.unitType === "per_kg" ? `${item.quantity} kg` : item.quantity}
```

- [ ] **Step 6: Type check, tests, manual check**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.
Manual: in the buyer shop, a per-kg product shows "/kg" and a decimal kg input; add 1.5 kg to cart, checkout succeeds, order shows the correct total.

- [ ] **Step 7: Commit**

```bash
git add src/features/buyer/ src/app/buyer_portal/
git commit -m "feat(buyer): unit-aware prices and decimal kg quantities"
```

---

### Task 11: Full verification + docs

**Files:**
- Modify: `documentation/seller-dashboard-implementation.md` (append changelog section)

- [ ] **Step 1: Full test suite, types, lint**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all pass. Fix anything that fails before proceeding.

- [ ] **Step 2: End-to-end manual smoke**

With the stack running, walk the full loop once: create category → product with photo → per-kg variant + per-piece variant → seller creates an order with 1.5 kg + 2 pcs → order detail shows "1.5 kg" and "RM x.xx /kg" → buyer shop shows unit prices → buyer orders 0.5 kg → both orders' totals correct.

- [ ] **Step 3: Document the changes**

Append to `documentation/seller-dashboard-implementation.md`:

```markdown
---

## Changelog — 2026-07-29: Units, images, and fixes

- `product_variants.unit_type` (`per_kg` | `per_piece`); `price_per_unit` is RM/kg or RM/piece accordingly.
- `order_items.quantity` and `buyer_order_items.quantity` are now `numeric(10,3)` (decimal kg supported).
- Added missing DELETE RLS policies (categories, products, variants, customers); orders remain non-deletable.
- Product images upload to the public `product-images` Storage bucket at `{organization_id}/{uuid}.{ext}`.
- Products page is a card grid with category chips; client split into `src/features/seller/components/products/`.
- Fixed: org slug was passed where the org UUID was required (Add Category/Product/Variant); `requireSellerRole` now checks the current user; revalidation uses real paths.
- Pricing helpers in `src/features/seller/lib/pricing.ts`; catalog grid helpers in `src/features/seller/lib/catalog-model.ts` (unit-tested).
```

- [ ] **Step 4: Final commit**

```bash
git add documentation/seller-dashboard-implementation.md
git commit -m "docs: catalog units/images changelog"
```
