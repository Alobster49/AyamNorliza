"use client";

import Image from "next/image";
import { ImageOff, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import type { ProductVariant, UnitType } from "@/features/seller/types";
import type { CatalogProduct } from "@/features/seller/lib/catalog-model";
import { formatVariantPrice } from "@/features/seller/lib/pricing";

type SellerProductCardProps = {
  product: CatalogProduct;
  onEdit: () => void;
  onDelete: () => void;
  onAddVariant: () => void;
  onEditVariant: (variant: ProductVariant) => void;
  onDeleteVariant: (variant: ProductVariant) => void;
};

export function SellerProductCard({
  product,
  onEdit,
  onDelete,
  onAddVariant,
  onEditVariant,
  onDeleteVariant,
}: SellerProductCardProps) {
  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="relative aspect-[4/3] bg-muted">
        {product.image_url ? (
          <Image src={product.image_url} alt={product.name} fill className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-10 w-10" />
          </div>
        )}
        {!product.is_active && (
          <span className="absolute left-2 top-2 rounded-full bg-gray-900/80 px-2 py-0.5 text-xs text-white">
            Inactive
          </span>
        )}
      </div>
      <CardHeader className="p-4 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-semibold leading-tight">{product.name}</h3>
            {product.description && (
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                {product.description}
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onDelete}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 p-4 pt-0">
        {product.variants.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sizes/prices yet.</p>
        ) : (
          <ul className="space-y-1">
            {product.variants.map((variant) => (
              <li key={variant.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      variant.is_available ? "bg-green-500" : "bg-gray-300"
                    }`}
                  />
                  <span className="truncate">{variant.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="font-medium">
                    {formatVariantPrice(
                      Number(variant.price_per_unit),
                      variant.unit_type as UnitType,
                    )}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => onEditVariant(variant)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => onDeleteVariant(variant)}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <CardFooter className="p-4 pt-0">
        <Button variant="outline" size="sm" className="w-full" onClick={onAddVariant}>
          <Plus className="mr-2 h-4 w-4" />
          Add Size/Option
        </Button>
      </CardFooter>
    </Card>
  );
}
