"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ProductVariant } from "@/features/seller/types";
import type { CatalogProduct } from "@/features/seller/lib/catalog-model";
import { AvailabilitySwitch } from "./availability-switch";
import { ProductActionsMenu } from "./product-actions-menu";

type ProductLedgerProps = {
  products: CatalogProduct[];
  onEditProduct: (product: CatalogProduct) => void;
  onDeleteProduct: (product: CatalogProduct) => void;
  onArchiveProduct: (product: CatalogProduct) => void;
  onRestoreProduct: (product: CatalogProduct) => void;
  onAddVariant: (product: CatalogProduct) => void;
  onEditVariant: (product: CatalogProduct, variant: ProductVariant) => void;
  onDeleteVariant: (product: CatalogProduct, variant: ProductVariant) => void;
  onToggleVariant: (product: CatalogProduct, variant: ProductVariant) => void;
};

/**
 * Table view of the catalog: one row per sellable size, grouped under its
 * product. Built for price work — scan, compare, edit.
 */
export function ProductLedger({
  products,
  onEditProduct,
  onDeleteProduct,
  onArchiveProduct,
  onRestoreProduct,
  onAddVariant,
  onEditVariant,
  onDeleteVariant,
  onToggleVariant,
}: ProductLedgerProps) {
  const t = useTranslations("seller.products.ledger");
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {/* Column header (hidden on small screens where rows stack) */}
      <div className="hidden grid-cols-[minmax(10rem,1.6fr)_6rem_7rem] items-center gap-3 border-b bg-muted/50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:grid">
        <span>{t("sizeOption")}</span>
        <span>{t("unit")}</span>
        <span className="text-right">{t("status")}</span>
      </div>

      {products.map((product) => (
        <section key={product.id}>
          {/* Product group header */}
          <div className="group flex items-center gap-2 border-b bg-muted/30 px-4 py-2">
            <span className="min-w-0 truncate text-sm font-semibold">{product.name}</span>
            {!product.is_active && (
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {t("archived")}
              </span>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => onAddVariant(product)}
                aria-label={t("addSizeAriaLabel", { name: product.name })}
                className="rounded p-1 text-muted-foreground opacity-0 transition-[opacity,color] duration-150 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-60"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onEditProduct(product)}
                aria-label={t("editAriaLabel", { name: product.name })}
                className="rounded p-1 text-muted-foreground opacity-0 transition-[opacity,color] duration-150 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-60"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <ProductActionsMenu
                product={product}
                onEdit={() => onEditProduct(product)}
                onAddVariant={() => onAddVariant(product)}
                onArchive={() => onArchiveProduct(product)}
                onRestore={() => onRestoreProduct(product)}
                onDelete={() => onDeleteProduct(product)}
              />
            </span>
          </div>

          {product.variants.length === 0 ? (
            <button
              type="button"
              onClick={() => onAddVariant(product)}
              className="block w-full border-b px-4 py-2.5 text-left text-sm text-muted-foreground transition-colors duration-150 hover:bg-accent/40 active:bg-accent/60"
            >
              {t("addFirstSize", { name: product.name })}
            </button>
          ) : (
            product.variants.map((variant) => (
              <LedgerRow
                key={variant.id}
                product={product}
                variant={variant}
                onEdit={() => onEditVariant(product, variant)}
                onDelete={() => onDeleteVariant(product, variant)}
                onToggle={() => onToggleVariant(product, variant)}
              />
            ))
          )}
        </section>
      ))}
    </div>
  );
}

type LedgerRowProps = {
  product: CatalogProduct;
  variant: ProductVariant;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
};

function LedgerRow({ product, variant, onEdit, onDelete, onToggle }: LedgerRowProps) {
  const t = useTranslations("seller.products.ledger");
  const tUnit = useTranslations("seller.products.unitTypes");
  const unavailable = !variant.is_available;
  const unitLabel =
    variant.unit_type === "per_kg"
      ? tUnit("perKg")
      : variant.unit_type === "per_piece"
        ? tUnit("perPiece")
        : variant.unit_type;
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-b px-4 py-2.5 text-sm transition-colors duration-150 last:border-b-0 hover:bg-accent/30 sm:grid-cols-[minmax(10rem,1.6fr)_6rem_7rem] sm:items-center">
      <button
        type="button"
        onClick={onEdit}
        className={`min-w-0 truncate text-left hover:underline ${unavailable ? "text-muted-foreground" : ""}`}
      >
        {variant.name}
      </button>
      <span className="order-3 text-xs text-muted-foreground sm:order-none">{unitLabel}</span>
      <span className="order-4 flex items-center justify-end gap-1.5 sm:order-none">
        <AvailabilitySwitch
          available={variant.is_available}
          onToggle={onToggle}
          label={`${product.name} ${variant.name}`}
        />
        <button
          type="button"
          onClick={onDelete}
          aria-label={t("deleteAriaLabel", { name: variant.name })}
          className="rounded p-1 text-muted-foreground transition-colors duration-150 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </span>
    </div>
  );
}
