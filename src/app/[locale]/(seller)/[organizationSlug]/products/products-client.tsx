"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { LayoutGrid, Plus, Rows3, Search } from "lucide-react";
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
  type CatalogFilter,
  type CatalogProduct,
} from "@/features/seller/lib/catalog-model";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { CategoryDialog } from "@/features/seller/components/products/category-dialog";
import { ProductDialog } from "@/features/seller/components/products/product-dialog";
import { VariantDialog } from "@/features/seller/components/products/variant-dialog";
import {
  ProductCatalog,
  type CatalogView,
} from "@/features/seller/components/products/product-catalog";
import { ViewToggle, ViewButton } from "@/components/shared/view-toggle";

const VIEW_STORAGE_KEY = "seller-catalog-view";

type DialogState =
  | { kind: "category"; category?: Category }
  | { kind: "product"; product?: CatalogProduct; defaultCategoryId?: string }
  | { kind: "variant"; productId: string; variant?: ProductVariant }
  | null;

type ConfirmState =
  | { kind: "category"; category: Category }
  | { kind: "product"; product: CatalogProduct }
  | { kind: "variant"; product: CatalogProduct; variant: ProductVariant }
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
  const t = useTranslations("seller.products.client");
  const tToolbar = useTranslations("seller.products.toolbar");
  const [categories, setCategories] = useState(initialCategories);
  const [products, setProducts] = useState(initialProducts);
  const [selectedCategoryId, setSelectedCategoryId] = useState<CatalogFilter>(null);
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  // Content and visibility are separate so the closing dialog keeps its text
  // during the exit animation instead of unmounting abruptly.
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const openConfirm = (state: NonNullable<ConfirmState>) => {
    setConfirm(state);
    setConfirmOpen(true);
  };

  // Default to cards; restore the device's last choice after mount so the
  // server render never mismatches.
  const [view, setView] = useState<CatalogView>("cards");
  useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time localStorage restore; a lazy initializer would mismatch the SSR render
    if (stored === "cards" || stored === "ledger") setView(stored);
  }, []);

  const changeView = (next: CatalogView) => {
    setView(next);
    window.localStorage.setItem(VIEW_STORAGE_KEY, next);
  };

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

  const performDeleteCategory = async (category: Category) => {
    try {
      await deleteCategory(organizationSlug, category.id);
      setCategories((prev) => prev.filter((c) => c.id !== category.id));
      if (selectedCategoryId === category.id) setSelectedCategoryId(null);
      toast({ title: t("categoryDeleted") });
    } catch (error) {
      toast({
        title: t("error"),
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  const handleArchiveProduct = async (product: CatalogProduct, archived: boolean) => {
    try {
      const saved = await setProductArchived(organizationSlug, product.id, archived);
      setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, ...saved } : p)));
      toast({
        title: archived ? t("productArchived") : t("productRestored"),
        description: archived
          ? t("productArchivedDescription", { name: product.name })
          : t("productRestoredDescription", { name: product.name }),
      });
    } catch (error) {
      toast({
        title: t("error"),
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
  const requestDeleteProduct = async (product: CatalogProduct) => {
    try {
      const orderCount = await countProductOrderItems(organizationSlug, product.id);
      if (orderCount > 0) {
        toast({
          title: t("cannotDeleteTitle"),
          description: t("cannotDeleteDescription", { name: product.name, count: orderCount }),
          variant: "destructive",
        });
        return;
      }
      openConfirm({ kind: "product", product });
    } catch (error) {
      toast({
        title: t("error"),
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  const performDeleteProduct = async (product: CatalogProduct) => {
    try {
      await deleteProduct(organizationSlug, product.id);
      setProducts((prev) => prev.filter((p) => p.id !== product.id));
      toast({ title: t("productDeleted") });
    } catch (error) {
      toast({
        title: t("error"),
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

  // Optimistic one-tap sold-out toggle; rolls back on failure. The switch
  // itself is the success feedback — a toast per tap turns rapid price-list
  // sweeps into a notification storm, so only failures speak up.
  const handleToggleVariant = async (product: CatalogProduct, variant: ProductVariant) => {
    const next = !variant.is_available;
    setVariantAvailability(variant.id, product.id, next);
    try {
      await updateVariant(organizationSlug, variant.id, { is_available: next });
    } catch (error) {
      setVariantAvailability(variant.id, product.id, !next);
      toast({
        title: t("error"),
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  const performDeleteVariant = async (product: CatalogProduct, variant: ProductVariant) => {
    try {
      await deleteVariant(organizationSlug, variant.id);
      setProducts((prev) =>
        prev.map((p) =>
          p.id === product.id
            ? { ...p, variants: p.variants.filter((v) => v.id !== variant.id) }
            : p,
        ),
      );
      toast({ title: t("variantDeleted") });
    } catch (error) {
      toast({
        title: t("error"),
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  // "archived" is a view, not a category, so it must not preselect one.
  const activeCategoryId =
    selectedCategoryId === ARCHIVED_VIEW ? undefined : (selectedCategoryId ?? undefined);

  // With no categories yet, "Add Product" routes to the category dialog with
  // a hint instead of sitting disabled with no explanation.
  const handleAddProduct = () => {
    if (categories.length === 0) {
      toast({
        title: t("needCategoryFirstTitle"),
        description: t("needCategoryFirstDescription"),
      });
      setDialog({ kind: "category" });
      return;
    }
    setDialog({ kind: "product", defaultCategoryId: activeCategoryId });
  };

  const confirmContent =
    confirm?.kind === "category"
      ? {
          title: t("deleteCategoryTitle"),
          description: t("deleteCategoryConfirm", { name: confirm.category.name }),
          onConfirm: () => performDeleteCategory(confirm.category),
        }
      : confirm?.kind === "product"
        ? {
            title: t("deleteProductTitle"),
            description: t("deleteProductConfirm", { name: confirm.product.name }),
            onConfirm: () => performDeleteProduct(confirm.product),
          }
        : confirm?.kind === "variant"
          ? {
              title: t("deleteVariantTitle"),
              description: t("deleteVariantConfirm", {
                variant: confirm.variant.name,
                product: confirm.product.name,
              }),
              onConfirm: () => performDeleteVariant(confirm.product, confirm.variant),
            }
          : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="relative mr-auto w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={tToolbar("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSearch("");
            }}
            className="pl-9"
          />
        </div>
        <ViewToggle label={tToolbar("viewAriaLabel")}>
          <ViewButton
            active={view === "cards"}
            onClick={() => changeView("cards")}
            icon={<LayoutGrid className="h-3.5 w-3.5" />}
            label={tToolbar("cardsView")}
          />
          <ViewButton
            active={view === "ledger"}
            onClick={() => changeView("ledger")}
            icon={<Rows3 className="h-3.5 w-3.5" />}
            label={tToolbar("ledgerView")}
          />
        </ViewToggle>
        <Button onClick={handleAddProduct}>
          <Plus className="mr-2 h-4 w-4" />
          {tToolbar("addProduct")}
        </Button>
      </div>

      <ProductCatalog
        categories={categories}
        products={products}
        selectedCategoryId={selectedCategoryId}
        view={view}
        searchQuery={search}
        onClearSearch={() => setSearch("")}
        onSelectCategory={setSelectedCategoryId}
        onAddCategory={() => setDialog({ kind: "category" })}
        onEditCategory={(category) => setDialog({ kind: "category", category })}
        onDeleteCategory={(category) => openConfirm({ kind: "category", category })}
        onEditProduct={(product) => setDialog({ kind: "product", product })}
        onDeleteProduct={requestDeleteProduct}
        onAddProduct={handleAddProduct}
        onArchiveProduct={(product) => handleArchiveProduct(product, true)}
        onRestoreProduct={(product) => handleArchiveProduct(product, false)}
        onAddVariant={(product) => setDialog({ kind: "variant", productId: product.id })}
        onEditVariant={(product, variant) =>
          setDialog({ kind: "variant", productId: product.id, variant })
        }
        onDeleteVariant={(product, variant) => openConfirm({ kind: "variant", product, variant })}
        onToggleVariant={handleToggleVariant}
      />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(next) => {
          if (!next) setConfirmOpen(false);
        }}
        title={confirmContent?.title ?? ""}
        description={confirmContent?.description ?? ""}
        confirmLabel={t("confirmDelete")}
        onConfirm={() => confirmContent?.onConfirm()}
      />

      <CategoryDialog
        open={dialog?.kind === "category"}
        onOpenChange={closeDialog}
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
        organizationSlug={organizationSlug}
        productId={dialog?.kind === "variant" ? dialog.productId : ""}
        variant={dialog?.kind === "variant" ? dialog.variant : undefined}
        onSaved={handleVariantSaved}
      />
    </div>
  );
}
