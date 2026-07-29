"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ShoppingCart, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Product, ProductVariant } from "../types";

type ProductCardProps = {
  product: Product;
  variants?: ProductVariant[];
  onAddToCart?: (variantId: string, quantity: number) => void;
  showAddToCart?: boolean;
};

export function ProductCard({
  product,
  variants = [],
  onAddToCart,
  showAddToCart = true,
}: ProductCardProps) {
  const [selectedVariantId, setSelectedVariantId] = useState<string>(
    variants.find((v) => v.is_available)?.id ?? "",
  );
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  const selectedVariant = variants.find((v) => v.id === selectedVariantId);
  const availableVariants = variants.filter((v) => v.is_available);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("en-MY", {
      style: "currency",
      currency: "MYR",
    }).format(price);
  };

  const handleAddToCart = () => {
    if (selectedVariantId && onAddToCart) {
      onAddToCart(selectedVariantId, quantity);
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
    }
  };

  return (
    <Card className="overflow-hidden">
      <Link href={`/product/${product.id}`} className="block">
        <div className="relative aspect-square bg-muted">
          {product.image_url ? (
            <Image
              src={product.image_url}
              alt={product.name}
              fill
              className="object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <ShoppingCart className="h-12 w-12" />
            </div>
          )}
        </div>
      </Link>
      <CardHeader className="p-4 pb-2">
        <Link href={`/product/${product.id}`}>
          <CardTitle className="line-clamp-1 text-lg font-semibold hover:text-primary">
            {product.name}
          </CardTitle>
        </Link>
        {product.description && (
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
            {product.description}
          </p>
        )}
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="flex items-center justify-between">
          <div>
            {selectedVariant ? (
              <span className="text-lg font-bold">
                {formatPrice(Number(selectedVariant.price_per_unit))}
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  {selectedVariant.unit_type === "per_kg" ? "/kg" : "each"}
                </span>
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">Select variant</span>
            )}
          </div>
          {availableVariants.length > 1 && (
            <Select
              value={selectedVariantId}
              onValueChange={(id) => {
                setSelectedVariantId(id);
                setQuantity(1);
              }}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Select size" />
              </SelectTrigger>
              <SelectContent>
                {availableVariants.map((variant) => (
                  <SelectItem key={variant.id} value={variant.id}>
                    {variant.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </CardContent>
      {showAddToCart && onAddToCart && (
        <CardFooter className="p-4 pt-0">
          <div className="flex w-full gap-2">
            {selectedVariant?.unit_type === "per_kg" ? (
              <div className="flex w-28 items-center gap-1">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0.5}
                  step={0.5}
                  value={quantity}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === "") return;
                    const next = Number(raw);
                    if (!Number.isFinite(next)) return;
                    setQuantity(next);
                  }}
                  onBlur={(e) => {
                    const next = Number(e.target.value);
                    if (!Number.isFinite(next) || next < 0.5) setQuantity(0.5);
                  }}
                  className="text-center"
                />
                <span className="text-sm text-muted-foreground">kg</span>
              </div>
            ) : (
              <Select
                value={quantity.toString()}
                onValueChange={(v) => setQuantity(parseInt(v, 10))}
              >
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                    <SelectItem key={n} value={n.toString()}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              className="flex-1"
              onClick={handleAddToCart}
              disabled={!selectedVariantId || added}
            >
              {added ? (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Added!
                </>
              ) : (
                <>
                  <ShoppingCart className="mr-2 h-4 w-4" />
                  Add to Cart
                </>
              )}
            </Button>
          </div>
        </CardFooter>
      )}
    </Card>
  );
}
