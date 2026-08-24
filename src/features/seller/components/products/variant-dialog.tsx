"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { createVariant, updateVariant } from "@/features/seller/server/actions";
import { UNIT_TYPES, type ProductVariant, type UnitType } from "@/features/seller/types";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AvailabilitySwitch } from "./availability-switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { MARKET_ITEMS, type MarketMarginType } from "@/features/market/types";

type VariantDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  organizationSlug: string;
  productId: string;
  variant?: ProductVariant;
  onSaved: (variant: ProductVariant) => void;
};

export function VariantDialog({
  open,
  onOpenChange,
  organizationId,
  organizationSlug,
  productId,
  variant,
  onSaved,
}: VariantDialogProps) {
  const { toast } = useToast();
  const tCommon = useTranslations("common");
  const t = useTranslations("seller.products.variantDialog");
  const tUnit = useTranslations("seller.products.unitTypes");
  const [saving, setSaving] = useState(false);
  const [unitType, setUnitType] = useState<UnitType>(
    (variant?.unit_type as UnitType) ?? "per_piece",
  );
  const [available, setAvailable] = useState(variant?.is_available ?? true);
  const [benchmark, setBenchmark] = useState<string>(
    variant?.market_item_code != null ? String(variant.market_item_code) : "none",
  );
  const [marginType, setMarginType] = useState<MarketMarginType>(
    (variant?.market_margin_type as MarketMarginType) ?? "rm",
  );

  const unitLabel = (u: UnitType) => (u === "per_kg" ? tUnit("perKg") : tUnit("perPiece"));
  const priceLabel = unitType === "per_kg" ? t("priceLabelKg") : t("priceLabelPiece");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setSaving(true);
    try {
      const tracked = benchmark !== "none";
      const input = {
        name: data.get("name") as string,
        price_per_unit: Number(data.get("price_per_unit")),
        unit_type: unitType,
        is_available: available,
        market_item_code: tracked ? Number(benchmark) : null,
        market_margin_type: tracked ? marginType : null,
        market_margin_value: tracked ? Number(data.get("market_margin_value")) : null,
      };
      const saved = variant
        ? await updateVariant(variant.id, input, organizationSlug)
        : await createVariant(organizationId, { ...input, product_id: productId }, organizationSlug);
      onSaved(saved);
      onOpenChange(false);
      toast({ title: variant ? t("updated") : t("created") });
    } catch (error) {
      toast({
        title: t("error"),
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{variant ? t("editTitle") : t("addTitle")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="variant-name">{t("nameLabel")}</Label>
            <Input id="variant-name" name="name" defaultValue={variant?.name ?? ""} required />
          </div>
          <div className="space-y-2">
            <Label>{t("soldByLabel")}</Label>
            <Select value={unitType} onValueChange={(v) => setUnitType(v as UnitType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNIT_TYPES.map((u) => (
                  <SelectItem key={u} value={u}>
                    {unitLabel(u)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="variant-price">{priceLabel}</Label>
            <div className="relative">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground"
              >
                RM
              </span>
              <Input
                id="variant-price"
                name="price_per_unit"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                defaultValue={variant?.price_per_unit ?? ""}
                required
                className="pl-10 tabular-nums"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t("benchmarkLabel")}</Label>
            <Select value={benchmark} onValueChange={setBenchmark}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("notTracked")}</SelectItem>
                {MARKET_ITEMS.map((item) => (
                  <SelectItem key={item.code} value={String(item.code)}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {benchmark !== "none" && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>{t("marginTypeLabel")}</Label>
                <Select value={marginType} onValueChange={(v) => setMarginType(v as MarketMarginType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rm">{t("marginRm")}</SelectItem>
                    <SelectItem value="pct">{t("marginPct")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="variant-margin">
                  {marginType === "pct" ? t("marginLabelPct") : t("marginLabelRm")}
                </Label>
                <Input
                  id="variant-margin"
                  name="market_margin_value"
                  type="number"
                  step="0.01"
                  defaultValue={variant?.market_margin_value ?? ""}
                  required
                />
              </div>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5">
            <Label htmlFor="variant-available" className="cursor-pointer">
              {t("availableLabel")}
            </Label>
            <AvailabilitySwitch
              id="variant-available"
              available={available}
              onToggle={() => setAvailable(!available)}
              label={t("availableLabel")}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              {variant ? t("saveChanges") : t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
