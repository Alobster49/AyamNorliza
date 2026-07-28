"use client";

import { useState } from "react";
import { createCategory, updateCategory } from "@/features/seller/server/actions";
import type { Category } from "@/features/seller/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (data: FormData) => {
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
      toast({ title: category ? "Category updated" : "Category created" });
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
          <DialogTitle>{category ? "Edit Category" : "Add Category"}</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="category-name">Category Name</Label>
            <Input id="category-name" name="name" defaultValue={category?.name ?? ""} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="category-description">Description</Label>
            <Textarea
              id="category-description"
              name="description"
              defaultValue={category?.description ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="category-display-order">Display Order</Label>
            <Input
              id="category-display-order"
              name="display_order"
              type="number"
              defaultValue={category?.display_order ?? 0}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {category ? "Save Changes" : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
