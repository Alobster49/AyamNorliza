"use client";

import { useState } from "react";
import { createVariant, updateVariant } from "@/features/seller/server/actions";
import {
  UNIT_TYPE_LABELS,
  UNIT_TYPES,
  type ProductVariant,
  type UnitType,
} from "@/features/seller/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  const [saving, setSaving] = useState(false);
  const [unitType, setUnitType] = useState<UnitType>(
    (variant?.unit_type as UnitType) ?? "per_piece",
  );
  const [available, setAvailable] = useState(variant?.is_available ?? true);

  const priceLabel = unitType === "per_kg" ? "Price (RM per kg)" : "Price (RM per piece)";

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setSaving(true);
    try {
      const input = {
        name: data.get("name") as string,
        price_per_unit: Number(data.get("price_per_unit")),
        unit_type: unitType,
        is_available: available,
      };
      const saved = variant
        ? await updateVariant(variant.id, input, organizationSlug)
        : await createVariant(organizationId, { ...input, product_id: productId }, organizationSlug);
      onSaved(saved);
      onOpenChange(false);
      toast({ title: variant ? "Size/option updated" : "Size/option created" });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{variant ? "Edit Size/Option" : "Add Size/Option"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="variant-name">Name (e.g., Standard, Small, 1kg Pack)</Label>
            <Input id="variant-name" name="name" defaultValue={variant?.name ?? ""} required />
          </div>
          <div className="space-y-2">
            <Label>Sold by</Label>
            <Select value={unitType} onValueChange={(v) => setUnitType(v as UnitType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNIT_TYPES.map((u) => (
                  <SelectItem key={u} value={u}>
                    {UNIT_TYPE_LABELS[u]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="variant-price">{priceLabel}</Label>
            <Input
              id="variant-price"
              name="price_per_unit"
              type="number"
              step="0.01"
              min="0"
              defaultValue={variant?.price_per_unit ?? ""}
              required
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="variant-available"
              type="checkbox"
              checked={available}
              onChange={(e) => setAvailable(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="variant-available">Available for ordering</Label>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {variant ? "Save Changes" : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
