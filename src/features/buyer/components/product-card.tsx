"use client";

import { useState } from "react";
import Image from "next/image";
import { Bird } from "lucide-react";
import { ScaleChip } from "./scale-chip";
import { AddToCartSheet } from "./add-to-cart-sheet";
import { estimateRange, formatRM } from "@/features/buyer/lib/price-estimate";
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
  const [open, setOpen] = useState(false);
  const available = variants.filter((v) => v.is_available);
  const primary = available[0] ?? null;

  // Card-level estimate: the default 1 × 1.5–1.7 kg bird (or 1 piece/kg).
  const estimate = primary
    ? estimateRange({
        mode: primary.unit_type === "per_kg" ? "piece" : "piece",
        quantity: 1,
        sizeMinKg: 1.5,
        sizeMaxKg: 1.7,
        pricePerUnit: Number(primary.price_per_unit),
        unitType: primary.unit_type,
      })
    : null;

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
        <ScaleChip
          estimate={estimate}
          perUnitLabel={primary ? `${formatRM(Number(primary.price_per_unit))}${primary.unit_type === "per_kg" ? "/kg" : "/ekor"}` : undefined}
          onInfo={showInfo ? onInfo : undefined}
        />
        {onAddToCart && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={!primary}
            className="w-full rounded-full bg-primary py-2.5 font-medium text-primary-foreground transition-transform active:scale-[0.97] disabled:opacity-50"
          >
            + Tambah
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
