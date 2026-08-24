"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { createCategory, updateCategory } from "@/features/seller/server/actions";
import type { Category } from "@/features/seller/types";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type CategoryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  organizationSlug: string;
  category?: Category;
  onSaved: (category: Category) => void;
};

export function CategoryDialog({
  open,
  onOpenChange,
  organizationId,
  organizationSlug,
  category,
  onSaved,
}: CategoryDialogProps) {
  const { toast } = useToast();
  const tCommon = useTranslations("common");
  const t = useTranslations("seller.products.categoryDialog");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setSaving(true);
    try {
      const input = {
        name: data.get("name") as string,
        description: (data.get("description") as string) || null,
        display_order: Number(data.get("display_order")) || 0,
      };
      const saved = category
        ? await updateCategory(category.id, input, organizationSlug)
        : await createCategory(organizationId, { ...input, is_active: true }, organizationSlug);
      onSaved(saved);
      onOpenChange(false);
      toast({ title: category ? t("updated") : t("created") });
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
          <DialogTitle>{category ? t("editTitle") : t("addTitle")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="category-name">{t("nameLabel")}</Label>
            <Input id="category-name" name="name" defaultValue={category?.name ?? ""} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="category-description">{t("descriptionLabel")}</Label>
            <Textarea
              id="category-description"
              name="description"
              defaultValue={category?.description ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="category-display-order">{t("displayOrderLabel")}</Label>
            <Input
              id="category-display-order"
              name="display_order"
              type="number"
              defaultValue={category?.display_order ?? 0}
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
              {category ? t("saveChanges") : t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
