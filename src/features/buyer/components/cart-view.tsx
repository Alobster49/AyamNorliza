"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Bird, Minus, Plus, Trash2 } from "lucide-react";
import { useCart } from "./cart-context";
import { ScaleChip } from "./scale-chip";
import { PricingExplainerSheet } from "./pricing-explainer-sheet";
import {
  BUYER_FALLBACK_KEYS,
  cartEstimate,
  estimateRange,
  formatEstimate,
} from "@/features/buyer/lib/price-estimate";

export function CartView({
  organizationSlug,
  onNavigate,
}: {
  organizationSlug: string;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const { items, updateLine, removeLine } = useCart();
  const [explainerOpen, setExplainerOpen] = useState(false);
  const total = cartEstimate(items);
  const t = useTranslations("buyer.cart");
  const tPricing = useTranslations("buyer.pricing");
  const tProduct = useTranslations("buyer.product");

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <Bird className="mb-4 h-14 w-14 text-muted-foreground/50" strokeWidth={1.25} />
        <p className="font-buyer-display text-xl font-semibold">{t("emptyTitle")}</p>
        <button
          type="button"
          className="mt-6 rounded-full bg-primary px-6 py-2.5 font-medium text-primary-foreground transition-transform active:scale-[0.97]"
          onClick={() => {
            onNavigate?.();
            router.push(`/buyer_portal/${organizationSlug}/shop`);
          }}
        >
          {t("viewProducts")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-4">
        {items.map((item, index) => {
          const step = item.mode === "kg" ? 0.1 : 1;
          const min = item.mode === "kg" ? 0.1 : 1;
          const lineEstimate =
            item.pricePerUnit !== undefined && item.unitType !== undefined
              ? estimateRange({
                  mode: item.mode,
                  quantity: item.quantity,
                  sizeMinKg: item.sizeMinKg,
                  sizeMaxKg: item.sizeMaxKg,
                  pricePerUnit: item.pricePerUnit,
                  unitType: item.unitType,
                })
              : null;
          return (
            <li key={`${item.productId}-${index}`} className="flex items-start gap-3 border-b border-dashed pb-4 last:border-0 last:pb-0">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary">
                <Bird className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{item.productName}</p>
                <p className="text-sm text-muted-foreground">
                  {t("sizeLine", {
                    min: item.sizeMinKg,
                    max: item.sizeMaxKg,
                    fallback: tProduct(BUYER_FALLBACK_KEYS[item.fallback]),
                  })}
                </p>
                <ScaleChip estimate={lineEstimate} className="mt-1" />
              </div>
              <div className="flex items-center gap-1">
                <button type="button" aria-label={t("decrease")} className="flex h-11 w-11 items-center justify-center rounded-full border transition-transform active:scale-95"
                  onClick={() => updateLine(index, { quantity: Math.max(min, Math.round((item.quantity - step) * 1000) / 1000) })}>
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-14 text-center font-buyer-mono text-sm">
                  {item.mode === "kg" ? t("quantityKg", { quantity: item.quantity }) : item.quantity}
                </span>
                <button type="button" aria-label={t("increase")} className="flex h-11 w-11 items-center justify-center rounded-full border transition-transform active:scale-95"
                  onClick={() => updateLine(index, { quantity: Math.round((item.quantity + step) * 1000) / 1000 })}>
                  <Plus className="h-4 w-4" />
                </button>
                <button type="button" aria-label={t("remove")} className="ml-1 flex h-11 w-11 items-center justify-center rounded-full text-[color:var(--buyer-delta)] transition-transform active:scale-95"
                  onClick={() => removeLine(index)}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between border-t pt-4">
        <div>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {t("estimatedTotal")}
            <button type="button" aria-label={tPricing("whyEstimate")} className="underline decoration-dotted"
              onClick={() => setExplainerOpen(true)}>
              ?
            </button>
          </p>
          <p className="font-buyer-mono text-xl font-medium">
            {total ? formatEstimate(total) : "—"}
          </p>
        </div>
        <button
          type="button"
          className="rounded-full bg-primary px-6 py-3 font-medium text-primary-foreground transition-transform active:scale-[0.97]"
          onClick={() => {
            onNavigate?.();
            router.push(`/buyer_portal/${organizationSlug}/checkout`);
          }}
        >
          {t("checkout")}
        </button>
      </div>

      <PricingExplainerSheet open={explainerOpen} onOpenChange={setExplainerOpen} />
    </div>
  );
}
