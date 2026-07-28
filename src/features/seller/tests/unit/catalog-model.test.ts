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
