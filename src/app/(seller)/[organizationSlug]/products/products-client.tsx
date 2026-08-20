"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import {
  countProductOrderItems,
  deleteCategory,
  deleteProduct,
  deleteVariant,
  setProductArchived,
  updateVariant,
} from "@/features/seller/server/actions";
import type { Category, Product, ProductVariant } from "@/features/seller/types";
import {
  ARCHIVED_VIEW,
  catalogSummary,
  type CatalogFilter,
  type CatalogProduct,
} from "@/features/seller/lib/catalog-model";
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
  const [selectedCategoryId, setSelectedCategoryId] = useState<CatalogFilter>(null);
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

  const handleArchiveProduct = async (product: CatalogProduct, archived: boolean) => {
    try {
      const saved = await setProductArchived(product.id, archived, organizationSlug);
      setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, ...saved } : p)));
      toast({
        title: archived ? "Product archived" : "Product restored",
        description: archived
          ? `${product.name} is hidden from the shop. Past orders are untouched.`
          : `${product.name} is back on sale.`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  /**
   * Hard delete is only offered for products no order has ever referenced.
   * Anything with history is pushed towards archive, which is reversible and
   * keeps invoices and revenue reports whole.
   */
  const handleDeleteProduct = async (product: CatalogProduct) => {
    try {
      const orderCount = await countProductOrderItems(product.id);
      if (orderCount > 0) {
        toast({
          title: "Cannot delete — this product has order history",
          description: `${product.name} appears on ${orderCount} past order ${
            orderCount === 1 ? "line" : "lines"
          }. Archive it instead: it disappears from the shop and the orders stay intact.`,
          variant: "destructive",
        });
        return;
      }
      if (
        !confirm(
          `Permanently delete "${product.name}" and its sizes? It has never been ordered, so nothing else is affected.`,
        )
      ) {
        return;
      }
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

  const setVariantAvailability = (variantId: string, productId: string, available: boolean) => {
    setProducts((prev) =>
      prev.map((p) =>
        p.id === productId
          ? {
              ...p,
              variants: p.variants.map((v) =>
                v.id === variantId ? { ...v, is_available: available } : v,
              ),
            }
          : p,
      ),
    );
  };

  // Optimistic one-tap sold-out toggle; rolls back on failure.
  const handleToggleVariant = async (product: CatalogProduct, variant: ProductVariant) => {
    const next = !variant.is_available;
    setVariantAvailability(variant.id, product.id, next);
    try {
      await updateVariant(variant.id, { is_available: next }, organizationSlug);
      toast({
        title: next ? "Marked available" : "Marked sold out",
        description: `${product.name} — ${variant.name}`,
      });
    } catch (error) {
      setVariantAvailability(variant.id, product.id, !next);
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

  // "archived" is a view, not a category, so it must not preselect one.
  const activeCategoryId =
    selectedCategoryId === ARCHIVED_VIEW ? undefined : (selectedCategoryId ?? undefined);

  const summary = catalogSummary(products.filter((p) => p.is_active));
  const subtitle = [
    `${summary.productCount} ${summary.productCount === 1 ? "product" : "products"}`,
    `${summary.variantCount} ${summary.variantCount === 1 ? "size" : "sizes"}`,
    ...(summary.soldOutCount > 0 ? [`${summary.soldOutCount} sold out`] : []),
  ].join(" · ");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Products &amp; Catalog</h1>
          <p className="text-muted-foreground">{subtitle}</p>
        </div>
        <Button
          onClick={() =>
            setDialog({ kind: "product", defaultCategoryId: activeCategoryId })
          }
          disabled={categories.length === 0}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Product
        </Button>
      </div>

      <ProductCatalog
        categories={categories}
        products={products}
        selectedCategoryId={selectedCategoryId}
        onSelectCategory={setSelectedCategoryId}
        onAddCategory={() => setDialog({ kind: "category" })}
        onEditCategory={(category) => setDialog({ kind: "category", category })}
        onDeleteCategory={handleDeleteCategory}
        onEditProduct={(product) => setDialog({ kind: "product", product })}
        onDeleteProduct={handleDeleteProduct}
        onArchiveProduct={(product) => handleArchiveProduct(product, true)}
        onRestoreProduct={(product) => handleArchiveProduct(product, false)}
        onAddVariant={(product) => setDialog({ kind: "variant", productId: product.id })}
        onEditVariant={(product, variant) =>
          setDialog({ kind: "variant", productId: product.id, variant })
        }
        onDeleteVariant={handleDeleteVariant}
        onToggleVariant={handleToggleVariant}
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
        // Remount per target so the form's initial state comes from the
        // product being edited rather than the previously opened one.
        key={dialog?.kind === "product" ? `product-${dialog.product?.id ?? "new"}` : "product-idle"}
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
        key={dialog?.kind === "variant" ? `variant-${dialog.variant?.id ?? "new"}` : "variant-idle"}
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
