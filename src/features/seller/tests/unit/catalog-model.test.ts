import { describe, expect, it } from "vitest";
import {
  catalogSummary,
  countArchived,
  countByCategory,
  filterByCategory,
  filterCatalog,
  matchesCatalogSearch,
  priceRangeLabel,
  sortCategories,
  type CatalogProduct,
} from "../../lib/catalog-model";
import { formatPrice } from "../../lib/pricing";
import type { Category, ProductVariant } from "../../types";

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

describe("priceRangeLabel", () => {
  const variant = (over: Partial<ProductVariant>): ProductVariant => ({
    id: "v1",
    organization_id: "org-1",
    product_id: "prod-1",
    name: "Whole",
    unit_type: "per_kg",
    price_per_unit: 9.5,
    is_available: true,
    created_by: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    version: 1,
    market_item_code: null,
    market_margin_type: null,
    market_margin_value: null,
    ...over,
  });

  it("returns null for no variants", () => {
    expect(priceRangeLabel(product({ variants: [] }))).toBeNull();
  });

  it("shows single price for one variant", () => {
    const p = product({ variants: [variant({})] });
    expect(priceRangeLabel(p)).toBe(`${formatPrice(9.5)} · 1 size`);
  });

  it("shows min–max for several variants", () => {
    const p = product({
      variants: [
        variant({ id: "v1", price_per_unit: 9.5 }),
        variant({ id: "v2", price_per_unit: 16 }),
        variant({ id: "v3", price_per_unit: 10.2 }),
      ],
    });
    expect(priceRangeLabel(p)).toBe(`${formatPrice(9.5)} – ${formatPrice(16)} · 3 sizes`);
  });

  it("collapses equal min and max", () => {
    const p = product({
      variants: [
        variant({ id: "v1", price_per_unit: 9.5 }),
        variant({ id: "v2", price_per_unit: 9.5 }),
      ],
    });
    expect(priceRangeLabel(p)).toBe(`${formatPrice(9.5)} · 2 sizes`);
  });
});

describe("catalogSummary", () => {
  const variant = (over: Partial<ProductVariant>): ProductVariant => ({
    id: "v1",
    organization_id: "org-1",
    product_id: "prod-1",
    name: "Whole",
    unit_type: "per_kg",
    price_per_unit: 9.5,
    is_available: true,
    created_by: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    version: 1,
    market_item_code: null,
    market_margin_type: null,
    market_margin_value: null,
    ...over,
  });

  it("counts products, sizes and sold-out sizes", () => {
    const summary = catalogSummary([
      product({
        id: "p1",
        variants: [variant({ id: "v1" }), variant({ id: "v2", is_available: false })],
      }),
      product({ id: "p2", variants: [variant({ id: "v3" })] }),
    ]);
    expect(summary).toEqual({ productCount: 2, variantCount: 3, soldOutCount: 1 });
  });

  it("handles empty catalog", () => {
    expect(catalogSummary([])).toEqual({ productCount: 0, variantCount: 0, soldOutCount: 0 });
  });
});

describe("filterCatalog", () => {
  const active = product({ id: "p1", category_id: "cat-1", is_active: true });
  const otherCategory = product({ id: "p2", category_id: "cat-2", is_active: true });
  const archived = product({ id: "p3", category_id: "cat-1", is_active: false });
  const products = [active, otherCategory, archived];

  it("hides archived products from the live catalog", () => {
    expect(filterCatalog(products, null).map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("shows only archived products in the archived view", () => {
    expect(filterCatalog(products, "archived").map((p) => p.id)).toEqual(["p3"]);
  });

  it("filters to a category without showing its archived products", () => {
    expect(filterCatalog(products, "cat-1").map((p) => p.id)).toEqual(["p1"]);
  });
});

describe("countByCategory with archived products", () => {
  it("excludes archived products from category counts", () => {
    const counts = countByCategory([
      product({ id: "p1", category_id: "cat-1", is_active: true }),
      product({ id: "p2", category_id: "cat-1", is_active: false }),
    ]);
    expect(counts.get("cat-1")).toBe(1);
  });
});

describe("matchesCatalogSearch", () => {
  const variant = (over: Partial<ProductVariant>): ProductVariant => ({
    id: "v1",
    organization_id: "org-1",
    product_id: "prod-1",
    name: "Whole",
    unit_type: "per_kg",
    price_per_unit: 9.5,
    is_available: true,
    created_by: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    version: 1,
    market_item_code: null,
    market_margin_type: null,
    market_margin_value: null,
    ...over,
  });

  const p = product({
    name: "Ayam Kampung",
    category: category({ name: "Ayam Segar" }),
    variants: [variant({ name: "1kg Pack" })],
  });

  it("matches everything on an empty or whitespace query", () => {
    expect(matchesCatalogSearch(p, "")).toBe(true);
    expect(matchesCatalogSearch(p, "   ")).toBe(true);
  });

  it("matches product name case-insensitively", () => {
    expect(matchesCatalogSearch(p, "kampung")).toBe(true);
    expect(matchesCatalogSearch(p, "KAMPUNG")).toBe(true);
  });

  it("matches category and variant names", () => {
    expect(matchesCatalogSearch(p, "segar")).toBe(true);
    expect(matchesCatalogSearch(p, "1kg")).toBe(true);
  });

  it("rejects non-matching queries and tolerates a missing category", () => {
    expect(matchesCatalogSearch(p, "daging")).toBe(false);
    expect(matchesCatalogSearch(product({ name: "Ayam", category: null }), "ayam")).toBe(true);
  });
});

describe("countArchived", () => {
  it("counts archived products", () => {
    expect(
      countArchived([
        product({ id: "p1", is_active: true }),
        product({ id: "p2", is_active: false }),
        product({ id: "p3", is_active: false }),
      ]),
    ).toBe(2);
  });
});
