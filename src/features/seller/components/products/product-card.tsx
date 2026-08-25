"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { ProductVariant } from "@/features/seller/types";
import type { CatalogProduct } from "@/features/seller/lib/catalog-model";
import { AvailabilitySwitch } from "./availability-switch";
import { ProductActionsMenu } from "./product-actions-menu";

type SellerProductCardProps = {
  product: CatalogProduct;
  onEdit: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onAddVariant: () => void;
  onEditVariant: (variant: ProductVariant) => void;
  onDeleteVariant: (variant: ProductVariant) => void;
  onToggleVariant: (variant: ProductVariant) => void;
};

export function SellerProductCard({
  product,
  onEdit,
  onDelete,
  onArchive,
  onRestore,
  onAddVariant,
  onEditVariant,
  onDeleteVariant,
  onToggleVariant,
}: SellerProductCardProps) {
  const tLedger = useTranslations("seller.products.ledger");
  const tActionsMenu = useTranslations("seller.products.actionsMenu");
  const tCard = useTranslations("seller.products.card");

  return (
    <article
      className={`group flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md ${
        product.is_active ? "" : "border-dashed"
      }`}
    >
      {/* Image with the name laid over a scrim, so long names never reflow the card */}
      <div className="relative aspect-[5/3] bg-muted">
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            className={`object-cover ${product.is_active ? "" : "opacity-60 grayscale"}`}
          />
        ) : (
          <div
            aria-hidden
            className="flex h-full items-center justify-center bg-gradient-to-br from-amber-200/60 via-orange-300/50 to-orange-900/40 font-serif text-5xl text-orange-950/40 dark:from-amber-900/40 dark:via-orange-800/30 dark:to-stone-900/60 dark:text-orange-100/30"
          >
            {product.name.charAt(0).toUpperCase()}
          </div>
        )}
        {/* Scrim keeps the overlaid name readable on light photos */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/55 via-black/25 to-transparent"
        />
        {product.category && (
          <span className="absolute left-2 top-2 rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-900 backdrop-blur-sm">
            {product.category.name}
          </span>
        )}
        {!product.is_active && (
          <span className="absolute left-2 top-8 rounded-full bg-stone-900/85 px-2 py-0.5 text-xs font-medium text-white">
            {tLedger("archived")}
          </span>
        )}
        {/* Stays visible while the menu is open (has-[[data-state=open]]),
            on keyboard focus, and always on touch screens (pointer-coarse) */}
        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100 has-[[data-state=open]]:opacity-100 pointer-coarse:opacity-100">
          <button
            type="button"
            onClick={onEdit}
            aria-label={tLedger("editAriaLabel", { name: product.name })}
            className="grid h-8 w-8 place-items-center rounded-lg bg-white/85 text-stone-900 shadow backdrop-blur-sm transition-[background-color,transform] duration-150 hover:bg-white active:scale-95"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <ProductActionsMenu
            product={product}
            onEdit={onEdit}
            onAddVariant={onAddVariant}
            onArchive={onArchive}
            onRestore={onRestore}
            onDelete={onDelete}
            className="grid h-8 w-8 place-items-center rounded-lg bg-white/85 text-stone-900 shadow backdrop-blur-sm transition-[background-color,transform] duration-150 hover:bg-white active:scale-95"
          />
        </div>
        <h3 className="absolute inset-x-3 bottom-2.5 truncate text-base font-semibold text-white [text-shadow:0_1px_8px_rgba(0,0,0,.4)]">
          {product.name}
        </h3>
      </div>

      {/* Variant rail */}
      <div className="flex flex-1 flex-col">
        {product.variants.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">{tCard("noSizes")}</p>
        ) : (
          product.variants.map((variant) => (
            <div
              key={variant.id}
              className="flex items-center gap-2 border-t px-3.5 py-2.5 text-sm first:border-t-0"
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  variant.is_available ? "bg-green-500" : "bg-muted-foreground/40"
                }`}
              />
              <button
                type="button"
                onClick={() => onEditVariant(variant)}
                className={`min-w-0 flex-1 truncate text-left hover:underline ${
                  variant.is_available ? "" : "text-muted-foreground"
                }`}
              >
                {variant.name}
              </button>
              <AvailabilitySwitch
                available={variant.is_available}
                onToggle={() => onToggleVariant(variant)}
                label={`${product.name} ${variant.name}`}
              />
              <button
                type="button"
                onClick={() => onDeleteVariant(variant)}
                aria-label={tLedger("deleteAriaLabel", { name: variant.name })}
                className="rounded p-1 text-muted-foreground opacity-0 transition-[opacity,color] duration-150 focus-visible:opacity-100 group-hover:opacity-100 hover:text-destructive pointer-coarse:opacity-60"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))
        )}
        <button
          type="button"
          onClick={onAddVariant}
          className="mt-auto flex items-center justify-center gap-1 border-t border-dashed px-4 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground active:bg-accent/80"
        >
          <Plus className="h-3.5 w-3.5" />
          {tActionsMenu("addSize")}
        </button>
      </div>
    </article>
  );
}
