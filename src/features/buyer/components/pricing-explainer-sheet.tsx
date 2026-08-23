"use client";

import { Scale, Bird, BadgeCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { BuyerSheet } from "./buyer-sheet";
import { markExplainerSeen } from "@/features/buyer/lib/explainer-flag";

const FRAMES = [
  { icon: Bird, titleKey: "chooseTitle", bodyKey: "chooseBody" },
  { icon: Scale, titleKey: "weighTitle", bodyKey: "weighBody" },
  { icon: BadgeCheck, titleKey: "priceTitle", bodyKey: "priceBody" },
] as const;

export function PricingExplainerSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations("buyer.pricing");
  const tExplainer = useTranslations("buyer.pricing.explainer");
  const close = (next: boolean) => {
    if (!next) markExplainerSeen(window.localStorage);
    onOpenChange(next);
  };

  return (
    <BuyerSheet open={open} onOpenChange={close} title={t("whyEstimate")}>
      <div className="space-y-4">
        {FRAMES.map((f) => (
          <div key={f.titleKey} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary">
              <f.icon className="h-4.5 w-4.5" />
            </span>
            <div>
              <p className="font-medium">{tExplainer(f.titleKey)}</p>
              <p className="text-sm text-muted-foreground">{tExplainer(f.bodyKey)}</p>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => close(false)}
          className="mt-2 w-full rounded-full bg-primary py-3 font-medium text-primary-foreground transition-transform active:scale-[0.97]"
        >
          {t("gotIt")}
        </button>
      </div>
    </BuyerSheet>
  );
}
