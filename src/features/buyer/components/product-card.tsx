"use client";

import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Bird } from "lucide-react";
import { ScaleChip } from "./scale-chip";
import { AddToCartSheet } from "./add-to-cart-sheet";
import type { CartLine } from "./cart-context";
import type { Product, ProductVariant } from "../types";

type ProductCardProps = {
  product: Product;
  variants?: ProductVariant[];
  onAddToCart?: (line: CartLine) => void;
  /** Exactly one card on the shop page gets the ⓘ (the first). */
  showInfo?: boolean;
  onInfo?: () => void;
};

export function ProductCard({ product, variants = [], onAddToCart, showInfo, onInfo }: ProductCardProps) {
  const t = useTranslations("buyer.product");
  const [open, setOpen] = useState(false);
  const available = variants.filter((v) => v.is_available);
  const primary = available[0] ?? null;

  return (
    <article data-slot="card" className="overflow-hidden rounded-2xl border bg-card shadow-[0_2px_10px_rgba(58,49,41,0.06)]">
      <div className="relative aspect-[4/3] bg-secondary">
        {product.image_url ? (
          <Image src={product.image_url} alt={product.name} fill className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground/60">
            <Bird className="h-12 w-12" strokeWidth={1.25} />
          </div>
        )}
      </div>
      <div className="space-y-3 p-4">
        <h3 className="font-buyer-display text-lg font-semibold leading-tight">{product.name}</h3>
        <ScaleChip onInfo={showInfo ? onInfo : undefined} />
        {onAddToCart && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={!primary}
            className="w-full rounded-full bg-primary py-2.5 font-medium text-primary-foreground transition-transform active:scale-[0.97] disabled:opacity-50"
          >
            + {t("add")}
          </button>
        )}
      </div>
      {onAddToCart && (
        <AddToCartSheet
          product={product}
          variants={variants}
          open={open}
          onOpenChange={setOpen}
          onAdd={onAddToCart}
        />
      )}
    </article>
  );
}
