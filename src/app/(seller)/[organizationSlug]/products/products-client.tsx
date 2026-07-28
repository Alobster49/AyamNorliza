"use client";

import { useState } from "react";
import {
  createCategory,
  createProduct,
  createVariant,
  updateCategory,
  updateProduct,
  updateVariant,
  deleteCategory,
  deleteProduct,
  deleteVariant,
} from "@/features/seller/server/actions";
import type { Category, Product, ProductVariant } from "@/features/seller/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Pencil,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type ProductsClientProps = {
  organizationSlug: string;
  initialCategories: Category[];
  initialProducts: (Product & { variants: ProductVariant[] })[];
};

export function ProductsClient({
  organizationSlug,
  initialCategories,
  initialProducts,
}: ProductsClientProps) {
  const { toast } = useToast();
  const [categories, setCategories] = useState(initialCategories);
  const [products, setProducts] = useState(initialProducts);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<{
    type: "category" | "product" | "variant";
    item?: Category | Product | ProductVariant;
    parentId?: string;
  } | null>(null);

  const toggleCategory = (id: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateCategory = async (data: FormData) => {
    try {
      const newCategory = await createCategory(organizationSlug, {
        name: data.get("name") as string,
        description: (data.get("description") as string) || null,
        display_order: Number(data.get("display_order")) || 0,
        is_active: true,
      });
      setCategories([...categories, newCategory]);
      setProducts([...products, { ...newCategory, variants: [] }]);
      setDialogOpen(null);
      toast({ title: "Category created" });
    } catch (error) {
      toast({ title: "Error", description: String(error), variant: "destructive" });
    }
  };

  const handleUpdateCategory = async (data: FormData) => {
    if (!editingItem?.item) return;
    try {
      const updated = await updateCategory(editingItem.item.id, {
        name: data.get("name") as string,
        description: (data.get("description") as string) || null,
        display_order: Number(data.get("display_order")) || 0,
      });
      setCategories(categories.map((c) => (c.id === updated.id ? updated : c)));
      setDialogOpen(null);
      setEditingItem(null);
      toast({ title: "Category updated" });
    } catch (error) {
      toast({ title: "Error", description: String(error), variant: "destructive" });
    }
  };

  const handleDeleteCategory = async (id: string) => {
    try {
      await deleteCategory(id);
      setCategories(categories.filter((c) => c.id !== id));
      toast({ title: "Category deleted" });
    } catch (error) {
      toast({ title: "Error", description: String(error), variant: "destructive" });
    }
  };

  const handleCreateProduct = async (data: FormData) => {
    try {
      const newProduct = await createProduct(organizationSlug, {
        name: data.get("name") as string,
        category_id: data.get("category_id") as string,
        description: (data.get("description") as string) || null,
        is_active: true,
      });
      setProducts([
        ...products,
        { ...newProduct, variants: [], category: categories.find((c) => c.id === newProduct.category_id) },
      ]);
      setDialogOpen(null);
      toast({ title: "Product created" });
    } catch (error) {
      toast({ title: "Error", description: String(error), variant: "destructive" });
    }
  };

  const handleUpdateProduct = async (data: FormData) => {
    if (!editingItem?.item) return;
    try {
      const updated = await updateProduct(editingItem.item.id, {
        name: data.get("name") as string,
        description: (data.get("description") as string) || null,
      });
      setProducts(products.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
      setDialogOpen(null);
      setEditingItem(null);
      toast({ title: "Product updated" });
    } catch (error) {
      toast({ title: "Error", description: String(error), variant: "destructive" });
    }
  };

  const handleDeleteProduct = async (id: string) => {
    try {
      await deleteProduct(id);
      setProducts(products.filter((p) => p.id !== id));
      toast({ title: "Product deleted" });
    } catch (error) {
      toast({ title: "Error", description: String(error), variant: "destructive" });
    }
  };

  const handleCreateVariant = async (data: FormData) => {
    if (!editingItem?.parentId) return;
    try {
      const newVariant = await createVariant(organizationSlug, {
        product_id: editingItem.parentId,
        name: data.get("name") as string,
        price_per_unit: Number(data.get("price_per_unit")),
        is_available: true,
      });
      setProducts(
        products.map((p) =>
          p.id === editingItem.parentId ? { ...p, variants: [...(p.variants || []), newVariant] } : p
        )
      );
      setDialogOpen(null);
      setEditingItem(null);
      toast({ title: "Variant created" });
    } catch (error) {
      toast({ title: "Error", description: String(error), variant: "destructive" });
    }
  };

  const handleUpdateVariant = async (data: FormData) => {
    if (!editingItem?.item) return;
    try {
      const updated = await updateVariant(editingItem.item.id, {
        name: data.get("name") as string,
        price_per_unit: Number(data.get("price_per_unit")),
        is_available: data.get("is_available") === "true",
      });
      setProducts(
        products.map((p) => ({
          ...p,
          variants: p.variants?.map((v) => (v.id === updated.id ? updated : v)),
        }))
      );
      setDialogOpen(null);
      setEditingItem(null);
      toast({ title: "Variant updated" });
    } catch (error) {
      toast({ title: "Error", description: String(error), variant: "destructive" });
    }
  };

  const handleDeleteVariant = async (id: string, productId: string) => {
    try {
      await deleteVariant(id);
      setProducts(
        products.map((p) =>
          p.id === productId ? { ...p, variants: p.variants?.filter((v) => v.id !== id) } : p
        )
      );
      toast({ title: "Variant deleted" });
    } catch (error) {
      toast({ title: "Error", description: String(error), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Products & Catalog</h1>
          <p className="text-muted-foreground">Manage categories, products, and pricing</p>
        </div>
        <Button onClick={() => { setEditingItem({ type: "category" }); setDialogOpen("category"); }}>
          <Plus className="mr-2 h-4 w-4" />
          Add Category
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-24">Order</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((category) => (
              <>
                <TableRow key={category.id} className="bg-muted/50">
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => toggleCategory(category.id)}
                    >
                      {expandedCategories.has(category.id) ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </Button>
                  </TableCell>
                  <TableCell className="font-medium">{category.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {category.description || "-"}
                  </TableCell>
                  <TableCell>{category.display_order}</TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                        category.is_active
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {category.is_active ? "Active" : "Inactive"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          setEditingItem({ type: "category", item: category });
                          setDialogOpen("category");
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleDeleteCategory(category.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                {expandedCategories.has(category.id) && (
                  <>
                    {/* Products in this category */}
                    {products
                      .filter((p) => p.category_id === category.id)
                      .map((product) => (
                        <>
                          <TableRow key={product.id} className="pl-8">
                            <TableCell></TableCell>
                            <TableCell className="pl-8 font-medium">{product.name}</TableCell>
                            <TableCell className="pl-8 text-muted-foreground">
                              {product.description || "-"}
                            </TableCell>
                            <TableCell></TableCell>
                            <TableCell>
                              <span
                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                                  product.is_active
                                    ? "bg-green-100 text-green-800"
                                    : "bg-gray-100 text-gray-800"
                                }`}
                              >
                                {product.is_active ? "Active" : "Inactive"}
                              </span>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => {
                                    setEditingItem({ type: "product", item: product });
                                    setDialogOpen("product");
                                  }}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => handleDeleteProduct(product.id)}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                          {/* Variants */}
                          {product.variants?.map((variant) => (
                            <TableRow key={variant.id} className="pl-16">
                              <TableCell></TableCell>
                              <TableCell className="pl-16 text-muted-foreground">
                                {variant.name}
                              </TableCell>
                              <TableCell className="pl-16 font-medium">
                                RM {variant.price_per_unit.toFixed(2)}
                              </TableCell>
                              <TableCell></TableCell>
                              <TableCell>
                                <span
                                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                                    variant.is_available
                                      ? "bg-green-100 text-green-800"
                                      : "bg-gray-100 text-gray-800"
                                  }`}
                                >
                                  {variant.is_available ? "Available" : "Unavailable"}
                                </span>
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => {
                                      setEditingItem({ type: "variant", item: variant, parentId: product.id });
                                      setDialogOpen("variant");
                                    }}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => handleDeleteVariant(variant.id, product.id)}
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                          {/* Add variant button */}
                          <TableRow className="pl-16">
                            <TableCell colSpan={6}>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="ml-8"
                                onClick={() => {
                                  setEditingItem({ type: "variant", parentId: product.id });
                                  setDialogOpen("variant");
                                }}
                              >
                                <Plus className="mr-2 h-4 w-4" />
                                Add Size/Option
                              </Button>
                            </TableCell>
                          </TableRow>
                        </>
                      ))}
                    {/* Add product button */}
                    <TableRow>
                      <TableCell colSpan={6}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-4"
                          onClick={() => {
                            setEditingItem({ type: "product", item: undefined, parentId: category.id });
                            setDialogOpen("product");
                          }}
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Add Product
                        </Button>
                      </TableCell>
                    </TableRow>
                  </>
                )}
              </>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Category Dialog */}
      <Dialog open={dialogOpen === "category"} onOpenChange={() => { setDialogOpen(null); setEditingItem(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingItem?.item ? "Edit Category" : "Add Category"}
            </DialogTitle>
          </DialogHeader>
          <form
            action={editingItem?.item ? handleUpdateCategory : handleCreateCategory}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="name">Category Name</Label>
              <Input
                id="name"
                name="name"
                defaultValue={editingItem?.item ? (editingItem.item as Category).name : ""}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                defaultValue={editingItem?.item ? (editingItem.item as Category).description || "" : ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="display_order">Display Order</Label>
              <Input
                id="display_order"
                name="display_order"
                type="number"
                defaultValue={editingItem?.item ? (editingItem.item as Category).display_order : 0}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => { setDialogOpen(null); setEditingItem(null); }}>
                Cancel
              </Button>
              <Button type="submit">
                {editingItem?.item ? "Save Changes" : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Product Dialog */}
      <Dialog open={dialogOpen === "product"} onOpenChange={() => { setDialogOpen(null); setEditingItem(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingItem?.item ? "Edit Product" : "Add Product"}
            </DialogTitle>
          </DialogHeader>
          <form
            action={editingItem?.item ? handleUpdateProduct : handleCreateProduct}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="name">Product Name</Label>
              <Input
                id="name"
                name="name"
                defaultValue={editingItem?.item ? (editingItem.item as Product).name : ""}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category_id">Category</Label>
              <select
                id="category_id"
                name="category_id"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                defaultValue={editingItem?.parentId || ""}
                required
              >
                <option value="">Select category</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                defaultValue={editingItem?.item ? (editingItem.item as Product).description || "" : ""}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => { setDialogOpen(null); setEditingItem(null); }}>
                Cancel
              </Button>
              <Button type="submit">
                {editingItem?.item ? "Save Changes" : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Variant Dialog */}
      <Dialog open={dialogOpen === "variant"} onOpenChange={() => { setDialogOpen(null); setEditingItem(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingItem?.item ? "Edit Size/Option" : "Add Size/Option"}
            </DialogTitle>
          </DialogHeader>
          <form
            action={editingItem?.item ? handleUpdateVariant : handleCreateVariant}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="name">Size Name (e.g., Small, Medium, Large)</Label>
              <Input
                id="name"
                name="name"
                defaultValue={editingItem?.item ? (editingItem.item as ProductVariant).name : ""}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="price_per_unit">Price (RM)</Label>
              <Input
                id="price_per_unit"
                name="price_per_unit"
                type="number"
                step="0.01"
                min="0"
                defaultValue={editingItem?.item ? (editingItem.item as ProductVariant).price_per_unit : ""}
                required
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => { setDialogOpen(null); setEditingItem(null); }}>
                Cancel
              </Button>
              <Button type="submit">
                {editingItem?.item ? "Save Changes" : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
