"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ShoppingCart, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FALLBACKS,
  FALLBACK_LABELS,
  type OrderFallback,
  type OrderItemMode,
} from "@/features/orders/types";
import type { CartLine } from "./cart-context";
import type { Product, ProductVariant } from "../types";

type ProductCardProps = {
  product: Product;
  variants?: ProductVariant[];
  onAddToCart?: (line: CartLine) => void;
  showAddToCart?: boolean;
};

export function ProductCard({
  product,
  variants = [],
  onAddToCart,
  showAddToCart = true,
}: ProductCardProps) {
  const availableVariants = variants.filter((v) => v.is_available);
  const [selectedVariantId, setSelectedVariantId] = useState<string>(
    availableVariants[0]?.id ?? "",
  );
  const selectedVariant = variants.find((v) => v.id === selectedVariantId);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<OrderItemMode>(
    selectedVariant?.unit_type === "per_kg" ? "kg" : "piece",
  );
  const [quantity, setQuantity] = useState("1");
  const [sizeMinKg, setSizeMinKg] = useState("1.5");
  const [sizeMaxKg, setSizeMaxKg] = useState("1.7");
  const [fallback, setFallback] = useState<OrderFallback>("cancel");
  const [added, setAdded] = useState(false);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("en-MY", {
      style: "currency",
      currency: "MYR",
    }).format(price);
  };

  function resetDialog() {
    setMode(selectedVariant?.unit_type === "per_kg" ? "kg" : "piece");
    setQuantity("1");
    setSizeMinKg("1.5");
    setSizeMaxKg("1.7");
    setFallback("cancel");
  }

  const parsedQuantity = Number(quantity);
  const parsedMin = Number(sizeMinKg);
  const parsedMax = Number(sizeMaxKg);
  const isValid =
    Number.isFinite(parsedQuantity) &&
    parsedQuantity > 0 &&
    (mode === "piece" ? Number.isInteger(parsedQuantity) : true) &&
    Number.isFinite(parsedMin) &&
    parsedMin >= 0.1 &&
    parsedMin <= 50 &&
    Number.isFinite(parsedMax) &&
    parsedMax >= 0.1 &&
    parsedMax <= 50 &&
    parsedMax >= parsedMin;

  const handleAddToCart = () => {
    if (!isValid || !onAddToCart) return;
    onAddToCart({
      productId: product.id,
      productName: product.name,
      mode,
      quantity: parsedQuantity,
      sizeMinKg: parsedMin,
      sizeMaxKg: parsedMax,
      fallback,
    });
    setAdded(true);
    setOpen(false);
    setTimeout(() => setAdded(false), 2000);
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
              <span className="text-sm text-muted-foreground">Price varies</span>
            )}
          </div>
          {availableVariants.length > 1 && (
            <Select
              value={selectedVariantId}
              onValueChange={(id) => setSelectedVariantId(id)}
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
        {selectedVariant && (
          <p className="mt-1 text-xs text-muted-foreground">
            Indicative price — final price is set per kg when your order is
            closed.
          </p>
        )}
      </CardContent>
      {showAddToCart && onAddToCart && (
        <CardFooter className="p-4 pt-0">
          <Dialog
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (next) resetDialog();
            }}
          >
            <DialogTrigger asChild>
              <Button className="w-full" disabled={added}>
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
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{product.name}</DialogTitle>
                <DialogDescription>
                  Choose how you would like to order this product.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Order by</Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={mode === "piece" ? "default" : "outline"}
                      className="flex-1"
                      onClick={() => setMode("piece")}
                    >
                      Piece
                    </Button>
                    <Button
                      type="button"
                      variant={mode === "kg" ? "default" : "outline"}
                      className="flex-1"
                      onClick={() => setMode("kg")}
                    >
                      Kg
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="quantity">
                    Quantity {mode === "piece" ? "(birds)" : "(kg)"}
                  </Label>
                  <Input
                    id="quantity"
                    type="number"
                    inputMode={mode === "piece" ? "numeric" : "decimal"}
                    min={mode === "piece" ? 1 : 0.1}
                    step={mode === "piece" ? 1 : 0.1}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="size-min">Min size (kg/bird)</Label>
                    <Input
                      id="size-min"
                      type="number"
                      inputMode="decimal"
                      min={0.1}
                      max={50}
                      step={0.1}
                      value={sizeMinKg}
                      onChange={(e) => setSizeMinKg(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="size-max">Max size (kg/bird)</Label>
                    <Input
                      id="size-max"
                      type="number"
                      inputMode="decimal"
                      min={0.1}
                      max={50}
                      step={0.1}
                      value={sizeMaxKg}
                      onChange={(e) => setSizeMaxKg(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="fallback">Can&apos;t get this size?</Label>
                  <Select
                    value={fallback}
                    onValueChange={(v) => setFallback(v as OrderFallback)}
                  >
                    <SelectTrigger id="fallback" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FALLBACKS.map((value) => (
                        <SelectItem key={value} value={value}>
                          {FALLBACK_LABELS[value]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <DialogFooter>
                <Button type="button" onClick={handleAddToCart} disabled={!isValid}>
                  Add to cart
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardFooter>
      )}
    </Card>
  );
}
