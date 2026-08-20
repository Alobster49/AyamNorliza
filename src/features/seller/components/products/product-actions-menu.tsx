"use client";

import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CatalogProduct } from "@/features/seller/lib/catalog-model";

type ProductActionsMenuProps = {
  product: CatalogProduct;
  onEdit: () => void;
  onAddVariant: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
  className?: string;
};

/**
 * Edit / Add size / Archive / Delete for one product. Archive is the normal way
 * to retire a product; delete sits below a separator because it is only
 * possible for products that have never been ordered.
 */
export function ProductActionsMenu({
  product,
  onEdit,
  onAddVariant,
  onArchive,
  onRestore,
  onDelete,
  className,
}: ProductActionsMenuProps) {
  const archived = !product.is_active;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Actions for ${product.name}`}
        className={className ?? "rounded p-1 text-muted-foreground hover:text-foreground"}
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil className="mr-2 h-3.5 w-3.5" />
          Edit product
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onAddVariant}>
          <Plus className="mr-2 h-3.5 w-3.5" />
          Add size
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {archived ? (
          <DropdownMenuItem onSelect={onRestore}>
            <ArchiveRestore className="mr-2 h-3.5 w-3.5" />
            Restore to catalog
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={onArchive}>
            <Archive className="mr-2 h-3.5 w-3.5" />
            Archive
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          Delete permanently
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
