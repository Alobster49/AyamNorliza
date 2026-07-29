"use client";

import { useEffect, useState } from "react";
import { createProduct, updateProduct } from "@/features/seller/server/actions";
import type { Category, Product } from "@/features/seller/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ImageUpload } from "./image-upload";

type ProductDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  organizationSlug: string;
  categories: Category[];
  defaultCategoryId?: string;
  product?: Product;
  onSaved: (product: Product) => void;
};

export function ProductDialog({
  open,
  onOpenChange,
  organizationId,
  organizationSlug,
  categories,
  defaultCategoryId,
  product,
  onSaved,
}: ProductDialogProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(product?.image_url ?? null);
  const [categoryId, setCategoryId] = useState<string>(
    product?.category_id ?? defaultCategoryId ?? "",
  );

  // Re-sync when the dialog opens for a different product.
  useEffect(() => {
    if (open) {
      setImageUrl(product?.image_url ?? null);
      setCategoryId(product?.category_id ?? defaultCategoryId ?? "");
    }
  }, [open, product, defaultCategoryId]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    if (!categoryId) {
      toast({ title: "Please choose a category", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const input = {
        name: data.get("name") as string,
        description: (data.get("description") as string) || null,
        category_id: categoryId,
        image_url: imageUrl,
      };
      const saved = product
        ? await updateProduct(product.id, input, organizationSlug)
        : await createProduct(organizationId, { ...input, is_active: true }, organizationSlug);
      onSaved(saved);
      onOpenChange(false);
      toast({ title: product ? "Product updated" : "Product created" });
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
          <DialogTitle>{product ? "Edit Product" : "Add Product"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Photo</Label>
            <ImageUpload organizationId={organizationId} value={imageUrl} onChange={setImageUrl} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="product-name">Product Name</Label>
            <Input id="product-name" name="name" defaultValue={product?.name ?? ""} required />
          </div>
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="product-description">Description</Label>
            <Textarea
              id="product-description"
              name="description"
              defaultValue={product?.description ?? ""}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {product ? "Save Changes" : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
