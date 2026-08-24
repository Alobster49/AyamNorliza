"use client";

import { Archive, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Category } from "@/features/seller/types";
import { ARCHIVED_VIEW, type CatalogFilter } from "@/features/seller/lib/catalog-model";

type CategoryRailProps = {
  categories: Category[];
  counts: Map<string, number>;
  totalCount: number;
  archivedCount: number;
  selectedCategoryId: CatalogFilter;
  onSelectCategory: (filter: CatalogFilter) => void;
  onAddCategory: () => void;
  onEditCategory: (category: Category) => void;
  onDeleteCategory: (category: Category) => void;
};

/**
 * Category navigation: a pinned vertical rail on md+ screens that flattens
 * into a horizontally scrollable chip row on mobile.
 */
export function CategoryRail({
  categories,
  counts,
  totalCount,
  archivedCount,
  selectedCategoryId,
  onSelectCategory,
  onAddCategory,
  onEditCategory,
  onDeleteCategory,
}: CategoryRailProps) {
  const t = useTranslations("seller.products.categoryRail");
  return (
    <nav
      aria-label={t("ariaLabel")}
      className="scrollbar-none flex items-center gap-1 overflow-x-auto rounded-full border bg-card p-1 md:sticky md:top-20 md:block md:w-56 md:shrink-0 md:overflow-visible md:rounded-lg md:p-0"
    >
      <div className="hidden px-3 pb-1 pt-3 md:block">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("heading")}
        </span>
      </div>

      <RailItem
        label={t("allProducts")}
        count={totalCount}
        selected={selectedCategoryId === null}
        onSelect={() => onSelectCategory(null)}
      />
      {categories.map((category) => (
        <RailItem
          key={category.id}
          label={category.name}
          count={counts.get(category.id) ?? 0}
          selected={selectedCategoryId === category.id}
          onSelect={() => onSelectCategory(category.id)}
          onEdit={() => onEditCategory(category)}
          onDelete={() => onDeleteCategory(category)}
        />
      ))}

      {/* Stays visible while it is the current view, so restoring the last
          archived product doesn't strand the user on a filter with no entry. */}
      {(archivedCount > 0 || selectedCategoryId === ARCHIVED_VIEW) && (
        <RailItem
          label={t("archived")}
          count={archivedCount}
          icon={<Archive className="h-3.5 w-3.5 shrink-0 opacity-70" />}
          selected={selectedCategoryId === ARCHIVED_VIEW}
          onSelect={() => onSelectCategory(ARCHIVED_VIEW)}
        />
      )}

      <div className="hidden border-t border-dashed px-3 py-2 md:block">
        <button
          type="button"
          onClick={onAddCategory}
          className="text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          {t("addCategory")}
        </button>
      </div>
    </nav>
  );
}

type RailItemProps = {
  label: string;
  count: number;
  selected: boolean;
  onSelect: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  icon?: React.ReactNode;
};

function RailItem({ label, count, selected, onSelect, onEdit, onDelete, icon }: RailItemProps) {
  const t = useTranslations("seller.products.categoryRail");
  return (
    <div
      className={`group flex shrink-0 items-center rounded-full transition-colors duration-150 md:w-full md:rounded-none md:border-l-2 ${
        selected
          ? "bg-primary text-primary-foreground md:border-primary md:bg-accent md:text-accent-foreground"
          : "text-muted-foreground hover:text-foreground md:border-transparent md:hover:bg-accent/50"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 px-3.5 py-2 text-left text-sm md:px-3"
      >
        {icon}
        <span className="truncate font-medium">{label}</span>
        <span className="text-xs tabular-nums opacity-60">{count}</span>
      </button>
      {selected && onEdit && onDelete && (
        <span className="hidden items-center gap-0.5 pr-2 md:flex">
          <button
            type="button"
            onClick={onEdit}
            className="rounded p-1 hover:bg-background/60"
            aria-label={t("editAriaLabel", { label })}
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded p-1 text-destructive hover:bg-background/60"
            aria-label={t("deleteAriaLabel", { label })}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </span>
      )}
    </div>
  );
}
