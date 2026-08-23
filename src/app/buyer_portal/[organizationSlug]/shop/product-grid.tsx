"use client";

import { useEffect, useState } from "react";
import { ProductCard } from "@/features/buyer/components/product-card";
import { PricingExplainerSheet } from "@/features/buyer/components/pricing-explainer-sheet";
import { hasSeenExplainer } from "@/features/buyer/lib/explainer-flag";
import { useCart } from "@/features/buyer/components/cart-context";
import type { CatalogWithProducts } from "@/features/buyer/types";

export function ShopClient({ categories }: { categories: CatalogWithProducts[] }) {
  const { addLine } = useCart();
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [explainerOpen, setExplainerOpen] = useState(false);

  // Taught once: auto-open on the first ever shop visit.
  useEffect(() => {
    if (!hasSeenExplainer(window.localStorage)) {
      const t = setTimeout(() => setExplainerOpen(true), 600);
      return () => clearTimeout(t);
    }
  }, []);

  const visible =
    activeCategory === "all" ? categories : categories.filter((c) => c.id === activeCategory);
  // First product across the visible categories carries the single ⓘ trigger.
  // Defensive scan: don't rely on upstream filtering out empty categories.
  const firstProductId = visible.find((c) => c.products.length > 0)?.products[0]?.id;

  return (
    <div className="space-y-8">
      <nav
        aria-label="Kategori"
        className="sticky top-16 z-40 -mx-4 flex gap-2 overflow-x-auto bg-background/95 px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 [scrollbar-width:none] snap-x"
      >
        {[{ id: "all", name: "Semua" }, ...categories].map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setActiveCategory(c.id)}
            className={`shrink-0 snap-start rounded-full border px-4 py-1.5 text-sm transition-transform active:scale-95 ${
              activeCategory === c.id
                ? "border-foreground bg-foreground font-medium text-background"
                : "border-border bg-card"
            }`}
          >
            {c.name}
          </button>
        ))}
      </nav>

      {visible.map((category) => (
        <section key={category.id} className="space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-buyer-display text-2xl font-semibold">{category.name}</h2>
            {category.description && (
              <p className="hidden text-sm text-muted-foreground sm:block">{category.description}</p>
            )}
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {category.products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                variants={product.variants ?? []}
                onAddToCart={addLine}
                showInfo={product.id === firstProductId}
                onInfo={() => setExplainerOpen(true)}
              />
            ))}
          </div>
        </section>
      ))}

      <PricingExplainerSheet open={explainerOpen} onOpenChange={setExplainerOpen} />
    </div>
  );
}
