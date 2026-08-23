"use client";

import { ProductCard } from "@/features/buyer/components/product-card";
import { useCart } from "@/features/buyer/components/cart-context";
import type { CartLine } from "@/features/buyer/components/cart-context";
import type { CatalogWithProducts } from "@/features/buyer/types";

type ProductGridProps = {
  categories: CatalogWithProducts[];
};

export function ProductGrid({ categories }: ProductGridProps) {
  const { addLine } = useCart();

  const handleAddToCart = (line: CartLine) => {
    addLine(line);
  };

  return (
    <>
      {categories.map((category) => (
        <section key={category.id} className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold tracking-tight">
              {category.name}
            </h2>
            {category.description && (
              <p className="hidden text-sm text-muted-foreground sm:block">
                {category.description}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {category.products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                variants={product.variants ?? []}
                onAddToCart={handleAddToCart}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
