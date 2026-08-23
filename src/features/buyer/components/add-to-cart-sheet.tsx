"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { Minus, Plus, X, Shuffle, ArrowUp, ArrowDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BuyerSheet } from "./buyer-sheet";
import { ScaleChip } from "./scale-chip";
import type { CartLine } from "./cart-context";
import type { Product, ProductVariant } from "../types";
import { FALLBACKS, type OrderFallback, type OrderItemMode } from "@/features/orders/types";
import { estimateRange, BUYER_FALLBACK_LABELS, formatRM } from "@/features/buyer/lib/price-estimate";

const FALLBACK_ICONS: Record<OrderFallback, typeof X> = {
  cancel: X,
  mix: Shuffle,
  upsize: ArrowUp,
  downsize: ArrowDown,
};

type AddToCartSheetProps = {
  product: Product;
  variants: ProductVariant[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAdd: (line: CartLine) => void;
};

export function AddToCartSheet({ product, variants, open, onOpenChange, onAdd }: AddToCartSheetProps) {
  const available = variants.filter((v) => v.is_available);
  const [variantId, setVariantId] = useState(available[0]?.id ?? "");
  const variant = available.find((v) => v.id === variantId) ?? available[0] ?? null;

  const [mode, setMode] = useState<OrderItemMode>(variant?.unit_type === "per_kg" ? "kg" : "piece");
  const [quantity, setQuantity] = useState("1");
  const [sizeMinKg, setSizeMinKg] = useState("1.5");
  const [sizeMaxKg, setSizeMaxKg] = useState("1.7");
  const [fallback, setFallback] = useState<OrderFallback>("cancel");

  const parsedQuantity = Number(quantity);
  const parsedMin = Number(sizeMinKg);
  const parsedMax = Number(sizeMaxKg);
  const isValid =
    variant !== null &&
    Number.isFinite(parsedQuantity) &&
    parsedQuantity > 0 &&
    (mode === "piece" ? Number.isInteger(parsedQuantity) : true) &&
    Number.isFinite(parsedMin) && parsedMin >= 0.1 && parsedMin <= 50 &&
    Number.isFinite(parsedMax) && parsedMax >= 0.1 && parsedMax <= 50 &&
    parsedMax >= parsedMin;

  const estimate = useMemo(() => {
    if (!variant) return null;
    if (!isValid) return null;
    return estimateRange({
      mode,
      quantity: parsedQuantity,
      sizeMinKg: parsedMin,
      sizeMaxKg: parsedMax,
      pricePerUnit: Number(variant.price_per_unit),
      unitType: variant.unit_type,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, mode, parsedQuantity, parsedMin, parsedMax]);

  const step = (setter: (v: string) => void, current: string, delta: number, min: number, decimals: number) => {
    const next = Math.max(min, Math.round((Number(current) + delta) * 10 ** decimals) / 10 ** decimals);
    setter(String(next));
  };

  const handleAdd = () => {
    if (!isValid || !variant) return;
    onAdd({
      productId: product.id,
      productName: product.name,
      mode,
      quantity: parsedQuantity,
      sizeMinKg: parsedMin,
      sizeMaxKg: parsedMax,
      fallback,
      pricePerUnit: Number(variant.price_per_unit),
      unitType: variant.unit_type,
    });
    onOpenChange(false);
  };

  return (
    <BuyerSheet open={open} onOpenChange={onOpenChange} title={product.name}>
      <div className="space-y-5">
        {available.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {available.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setVariantId(v.id)}
                className={`rounded-full border px-3 py-1.5 text-sm transition-transform active:scale-95 ${
                  v.id === variant?.id ? "border-primary bg-primary/15 font-medium" : "border-border"
                }`}
              >
                {v.name} · {formatRM(Number(v.price_per_unit))}{v.unit_type === "per_kg" ? "/kg" : ""}
              </button>
            ))}
          </div>
        )}

        <div>
          <Label className="mb-2 block">Beli ikut</Label>
          <div className="relative grid grid-cols-2 rounded-full bg-secondary p-1" role="radiogroup" aria-label="Beli ikut">
            {(["piece", "kg"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className="relative z-10 rounded-full py-2 text-sm font-medium"
              >
                {mode === m && (
                  <motion.span
                    layoutId="mode-pill"
                    className="absolute inset-0 -z-10 rounded-full bg-card shadow-sm"
                    transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                  />
                )}
                {m === "piece" ? "Ekor" : "Kg"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label htmlFor="qty" className="mb-2 block">
            {mode === "piece" ? "Kuantiti (ekor)" : "Kuantiti (kg)"}
          </Label>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Kurang" className="flex h-11 w-11 items-center justify-center rounded-full border transition-transform active:scale-95"
              onClick={() => step(setQuantity, quantity, mode === "piece" ? -1 : -0.1, mode === "piece" ? 1 : 0.1, mode === "piece" ? 0 : 1)}>
              <Minus className="h-4 w-4" />
            </button>
            <Input id="qty" type="number" inputMode={mode === "piece" ? "numeric" : "decimal"}
              min={mode === "piece" ? 1 : 0.1} step={mode === "piece" ? 1 : 0.1}
              value={quantity} onChange={(e) => setQuantity(e.target.value)}
              className="h-11 text-center font-buyer-mono" />
            <button type="button" aria-label="Tambah kuantiti" className="flex h-11 w-11 items-center justify-center rounded-full border transition-transform active:scale-95"
              onClick={() => step(setQuantity, quantity, mode === "piece" ? 1 : 0.1, mode === "piece" ? 1 : 0.1, mode === "piece" ? 0 : 1)}>
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="size-min" className="mb-2 block">Saiz min (kg/ekor)</Label>
            <Input id="size-min" type="number" inputMode="decimal" min={0.1} max={50} step={0.1}
              value={sizeMinKg} onChange={(e) => setSizeMinKg(e.target.value)} className="h-11 font-buyer-mono" />
          </div>
          <div>
            <Label htmlFor="size-max" className="mb-2 block">Saiz maks (kg/ekor)</Label>
            <Input id="size-max" type="number" inputMode="decimal" min={0.1} max={50} step={0.1}
              value={sizeMaxKg} onChange={(e) => setSizeMaxKg(e.target.value)} className="h-11 font-buyer-mono" />
          </div>
        </div>

        <div>
          <Label className="mb-2 block">Kalau saiz tak ada?</Label>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Kalau saiz tak ada?">
            {FALLBACKS.map((value) => {
              const Icon = FALLBACK_ICONS[value];
              const selected = fallback === value;
              return (
                <button key={value} type="button" role="radio" aria-checked={selected}
                  onClick={() => setFallback(value)}
                  className={`flex items-center gap-2 rounded-2xl border p-3 text-left text-sm transition-transform active:scale-[0.97] ${
                    selected ? "border-primary bg-primary/15 font-medium" : "border-border"
                  }`}>
                  <Icon className="h-4 w-4 shrink-0" />
                  {BUYER_FALLBACK_LABELS[value]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between border-t pt-4">
          <ScaleChip estimate={estimate} />
          <button type="button" onClick={handleAdd} disabled={!isValid}
            className="rounded-full bg-primary px-6 py-3 font-medium text-primary-foreground transition-transform active:scale-[0.97] disabled:opacity-50">
            Tambah ke troli
          </button>
        </div>
      </div>
    </BuyerSheet>
  );
}
