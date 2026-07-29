"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createOrder, createCustomer, searchCustomers, getCatalogForOrdering } from "@/features/seller/server/actions";
import type { Customer, UnitType } from "@/features/seller/types";
import {
  formatPrice,
  formatQuantity,
  formatVariantPrice,
  isValidQuantity,
  lineSubtotal,
} from "@/features/seller/lib/pricing";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Minus, Plus, Search, ShoppingCart, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type CategoryWithProducts = {
  id: string;
  name: string;
  products: {
    id: string;
    name: string;
    variants: {
      id: string;
      name: string;
      price_per_unit: number;
      unit_type: string;
      is_available: boolean;
    }[];
  }[];
}[];

type CartItem = {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  price: number;
  unitType: UnitType;
  quantity: number;
};

type NewOrderClientProps = {
  organizationSlug: string;
  organizationId: string;
};

export function NewOrderClient({ organizationSlug, organizationId }: NewOrderClientProps) {
  const { toast } = useToast();
  const router = useRouter();
  const [catalog, setCatalog] = useState<CategoryWithProducts>([]);
  const [loading, setLoading] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [newCustomerMode, setNewCustomerMode] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "", address: "", notes: "" });
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState("");

  const loadCatalog = async () => {
    setLoading(true);
    try {
      const data = await getCatalogForOrdering(organizationId);
      setCatalog(data);
    } catch (error) {
      toast({ title: "Error loading catalog", description: String(error), variant: "destructive" });
    }
    setLoading(false);
  };

  const handleCustomerSearch = async (query: string) => {
    setCustomerSearch(query);
    if (query.length < 2) {
      setCustomerResults([]);
      return;
    }
    try {
      const results = await searchCustomers(organizationId, query);
      setCustomerResults(results);
    } catch (error) {
      console.error(error);
    }
  };

  const handleAddNewCustomer = async () => {
    if (!newCustomer.name || !newCustomer.phone) {
      toast({ title: "Name and phone are required", variant: "destructive" });
      return;
    }
    try {
      const customer = await createCustomer(organizationId, {
        name: newCustomer.name,
        phone: newCustomer.phone,
        address: newCustomer.address || null,
        notes: newCustomer.notes || null,
      });
      setSelectedCustomer(customer);
      setNewCustomerMode(false);
      toast({ title: "Customer created" });
    } catch (error) {
      toast({ title: "Error", description: String(error), variant: "destructive" });
    }
  };

  const addToCart = (
    variantId: string,
    productId: string,
    productName: string,
    variantName: string,
    price: number,
    unitType: UnitType,
  ) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.variantId === variantId);
      if (existing) {
        return prev.map((item) =>
          item.variantId === variantId ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }
      return [...prev, { variantId, productId, productName, variantName, price, unitType, quantity: 1 }];
    });
  };

  const updateQuantity = (variantId: string, quantity: number) => {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setCart((prev) => prev.filter((item) => item.variantId !== variantId));
    } else {
      setCart((prev) =>
        prev.map((item) => (item.variantId === variantId ? { ...item, quantity } : item)),
      );
    }
  };

  const removeFromCart = (variantId: string) => {
    setCart((prev) => prev.filter((item) => item.variantId !== variantId));
  };

  const cartTotal = cart.reduce((sum, item) => sum + lineSubtotal(item.price, item.quantity), 0);

  const submitOrder = async () => {
    if (!selectedCustomer) {
      toast({ title: "Please select a customer", variant: "destructive" });
      return;
    }
    if (cart.length === 0) {
      toast({ title: "Please add items to the order", variant: "destructive" });
      return;
    }

    const invalid = cart.find((item) => !isValidQuantity(item.quantity, item.unitType));
    if (invalid) {
      toast({
        title: `Invalid quantity for ${invalid.productName} (${invalid.variantName})`,
        description:
          invalid.unitType === "per_piece"
            ? "Piece quantities must be whole numbers."
            : "Weight must be greater than zero.",
        variant: "destructive",
      });
      return;
    }

    try {
      await createOrder(
        organizationId,
        {
          customer_id: selectedCustomer.id,
          status: "new",
          notes: notes || null,
        },
        cart.map((item) => ({
          variant_id: item.variantId,
          quantity: item.quantity,
          unit_price: item.price,
          subtotal: lineSubtotal(item.price, item.quantity),
        })),
        organizationSlug,
      );
      toast({ title: "Order created successfully" });
      router.push(`/${organizationSlug}/orders`);
    } catch (error) {
      toast({ title: "Error", description: String(error), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">New Order</h1>
          <p className="text-muted-foreground">Create a new customer order</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: Catalog */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-lg border">
            <div className="border-b p-4">
              <h2 className="font-semibold">Select Items</h2>
            </div>
            {catalog.length === 0 ? (
              <div className="p-8 text-center">
                <Button onClick={loadCatalog} disabled={loading}>
                  {loading ? "Loading..." : "Load Catalog"}
                </Button>
              </div>
            ) : (
              <div className="divide-y">
                {catalog.map((category) => (
                  <div key={category.id}>
                    <div className="bg-muted/50 px-4 py-2 font-medium">{category.name}</div>
                    {category.products.map((product) => (
                      <div key={product.id} className="border-b p-4 last:border-b-0">
                        <div className="mb-2 font-medium">{product.name}</div>
                        <div className="flex flex-wrap gap-2">
                          {product.variants.map((variant) => (
                            <Button
                              key={variant.id}
                              variant="outline"
                              size="sm"
                              disabled={!variant.is_available}
                              onClick={() =>
                                addToCart(
                                  variant.id,
                                  product.id,
                                  product.name,
                                  variant.name,
                                  variant.price_per_unit,
                                  variant.unit_type as UnitType,
                                )
                              }
                            >
                              {variant.name} —{" "}
                              {formatVariantPrice(variant.price_per_unit, variant.unit_type as UnitType)}
                            </Button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Order Summary */}
        <div className="space-y-4">
          {/* Customer Selection */}
          <div className="rounded-lg border p-4">
            <h2 className="mb-4 font-semibold">Customer</h2>
            {!newCustomerMode ? (
              <>
                <div className="relative mb-4">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search by name or phone..."
                    value={customerSearch}
                    onChange={(e) => handleCustomerSearch(e.target.value)}
                    className="pl-9"
                  />
                  {customerResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-md border bg-background shadow-lg">
                      {customerResults.map((customer) => (
                        <button
                          key={customer.id}
                          className="block w-full px-4 py-2 text-left hover:bg-muted"
                          onClick={() => {
                            setSelectedCustomer(customer);
                            setCustomerSearch("");
                            setCustomerResults([]);
                          }}
                        >
                          <div className="font-medium">{customer.name}</div>
                          <div className="text-sm text-muted-foreground">{customer.phone}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {selectedCustomer && (
                  <div className="rounded-md bg-muted p-3">
                    <div className="font-medium">{selectedCustomer.name}</div>
                    <div className="text-sm text-muted-foreground">{selectedCustomer.phone}</div>
                    {selectedCustomer.address && (
                      <div className="text-sm text-muted-foreground">{selectedCustomer.address}</div>
                    )}
                  </div>
                )}
                <Button
                  variant="outline"
                  className="mt-2 w-full"
                  onClick={() => setNewCustomerMode(true)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  New Customer
                </Button>
              </>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Name *</Label>
                  <Input
                    value={newCustomer.name}
                    onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Phone *</Label>
                  <Input
                    value={newCustomer.phone}
                    onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Address</Label>
                  <Input
                    value={newCustomer.address}
                    onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea
                    value={newCustomer.notes}
                    onChange={(e) => setNewCustomer({ ...newCustomer, notes: e.target.value })}
                  />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setNewCustomerMode(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleAddNewCustomer}>Save Customer</Button>
                </div>
              </div>
            )}
          </div>

          {/* Cart */}
          <div className="rounded-lg border p-4">
            <h2 className="mb-4 flex items-center gap-2 font-semibold">
              <ShoppingCart className="h-4 w-4" />
              Order Summary
            </h2>
            {cart.length === 0 ? (
              <p className="text-center text-muted-foreground">No items added yet</p>
            ) : (
              <div className="space-y-3">
                {cart.map((item) => {
                  const step = item.unitType === "per_kg" ? 0.5 : 1;
                  const min = item.unitType === "per_kg" ? 0.1 : 1;
                  return (
                    <div key={item.variantId} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{item.productName}</div>
                          <div className="text-sm text-muted-foreground">
                            {item.variantName} · {formatVariantPrice(item.price, item.unitType)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="font-medium">
                            {formatPrice(lineSubtotal(item.price, item.quantity))}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => removeFromCart(item.variantId)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() =>
                            updateQuantity(
                              item.variantId,
                              Math.round((item.quantity - step) * 1000) / 1000,
                            )
                          }
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <Input
                          type="number"
                          inputMode="decimal"
                          step={step}
                          min={min}
                          value={item.quantity}
                          onChange={(e) => updateQuantity(item.variantId, Number(e.target.value))}
                          className="h-7 w-20 text-center"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() =>
                            updateQuantity(
                              item.variantId,
                              Math.round((item.quantity + step) * 1000) / 1000,
                            )
                          }
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                        <span className="ml-1 text-sm text-muted-foreground">
                          {item.unitType === "per_kg" ? "kg" : "pcs"}
                        </span>
                      </div>
                    </div>
                  );
                })}
                <div className="border-t pt-3">
                  <div className="flex justify-between text-lg font-bold">
                    <span>Total</span>
                    <span>{formatPrice(cartTotal)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="rounded-lg border p-4">
            <h2 className="mb-4 font-semibold">Notes</h2>
            <Textarea
              placeholder="Order notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {/* Submit */}
          <Button
            className="w-full"
            size="lg"
            disabled={!selectedCustomer || cart.length === 0}
            onClick={submitOrder}
          >
            Create Order
          </Button>
        </div>
      </div>
    </div>
  );
}
