"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createCustomer, searchCustomers, getCatalogForOrdering } from "@/features/seller/server/actions";
import type { Customer } from "@/features/seller/types";
import { getActiveZones } from "@/features/orders/server/portal-actions";
import { getDeliveryOptionsForOrg, createManualOrder } from "@/features/orders/server/order-actions";
import type { DeliveryOption, DeliveryZone, OrderFallback, OrderItemMode } from "@/features/orders/types";
import { FALLBACKS, FALLBACK_LABELS } from "@/features/orders/types";
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
import { Plus, Search, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type CategoryWithProducts = Array<{
  id: string;
  name: string;
  products: Array<{ id: string; name: string }>;
}>;

type ProductOption = { id: string; name: string; categoryName: string };

type LineDraft = {
  key: string;
  productId: string;
  mode: OrderItemMode;
  quantity: string;
  sizeMinKg: string;
  sizeMaxKg: string;
  fallback: OrderFallback;
};

let lineKeySeq = 0;
function newLine(): LineDraft {
  lineKeySeq += 1;
  return {
    key: `line-${lineKeySeq}`,
    productId: "",
    mode: "piece",
    quantity: "1",
    sizeMinKg: "1",
    sizeMaxKg: "2",
    fallback: "mix",
  };
}

type NewOrderClientProps = {
  organizationSlug: string;
  organizationId: string;
};

export function NewOrderClient({ organizationSlug, organizationId }: NewOrderClientProps) {
  const { toast } = useToast();
  const router = useRouter();

  const [products, setProducts] = useState<ProductOption[]>([]);
  const [zones, setZones] = useState<DeliveryZone[]>([]);

  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [newCustomerMode, setNewCustomerMode] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "", address: "", notes: "" });

  const [lines, setLines] = useState<LineDraft[]>([newLine()]);

  const [zoneId, setZoneId] = useState("");
  const [deliveryOptions, setDeliveryOptions] = useState<DeliveryOption[]>([]);
  const [selectedOptionKey, setSelectedOptionKey] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const catalog = (await getCatalogForOrdering(organizationId)) as CategoryWithProducts;
      const flattened: ProductOption[] = catalog.flatMap((category) =>
        category.products.map((product) => ({
          id: product.id,
          name: product.name,
          categoryName: category.name,
        })),
      );
      setProducts(flattened);
    })();
    (async () => {
      const result = await getActiveZones(organizationSlug);
      if (result.ok) setZones(result.data);
    })();
  }, [organizationId, organizationSlug]);

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

  const handleZoneChange = async (nextZoneId: string) => {
    setZoneId(nextZoneId);
    setSelectedOptionKey("");
    setDeliveryOptions([]);
    if (!nextZoneId) return;
    const result = await getDeliveryOptionsForOrg(organizationSlug, nextZoneId);
    if (!result.ok) {
      toast({ title: "Error", description: result.message, variant: "destructive" });
      return;
    }
    setDeliveryOptions(result.data);
  };

  const addLine = () => setLines((prev) => [...prev, newLine()]);
  const removeLine = (key: string) => setLines((prev) => prev.filter((line) => line.key !== key));
  const updateLine = (key: string, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const selectedOption = deliveryOptions.find(
    (option) => `${option.slotId}-${option.date}` === selectedOptionKey,
  );

  const submitOrder = async () => {
    if (!selectedCustomer) {
      toast({ title: "Please select a customer", variant: "destructive" });
      return;
    }
    if (!zoneId || !selectedOption) {
      toast({ title: "Please pick a delivery zone and slot", variant: "destructive" });
      return;
    }
    if (!address.trim()) {
      toast({ title: "Please enter a delivery address", variant: "destructive" });
      return;
    }
    if (lines.length === 0 || lines.some((line) => !line.productId)) {
      toast({ title: "Please select a product for every line", variant: "destructive" });
      return;
    }
    for (const line of lines) {
      const quantity = Number(line.quantity);
      const sizeMinKg = Number(line.sizeMinKg);
      const sizeMaxKg = Number(line.sizeMaxKg);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        toast({ title: "Error", description: "Enter a valid quantity for every line.", variant: "destructive" });
        return;
      }
      if (line.mode === "piece" && !Number.isInteger(quantity)) {
        toast({ title: "Error", description: "Piece quantities must be whole numbers.", variant: "destructive" });
        return;
      }
      if (!Number.isFinite(sizeMinKg) || !Number.isFinite(sizeMaxKg) || sizeMinKg <= 0 || sizeMaxKg < sizeMinKg) {
        toast({ title: "Error", description: "Enter a valid size range for every line.", variant: "destructive" });
        return;
      }
    }

    const items = lines.map((line) => ({
      productId: line.productId,
      mode: line.mode,
      quantity: Number(line.quantity),
      sizeMinKg: Number(line.sizeMinKg),
      sizeMaxKg: Number(line.sizeMaxKg),
      fallback: line.fallback,
    }));

    setSubmitting(true);
    const result = await createManualOrder({
      organizationSlug,
      customerId: selectedCustomer.id,
      zoneId,
      slotId: selectedOption.slotId,
      deliveryDate: selectedOption.date,
      address,
      notes: notes || undefined,
      items,
    });
    setSubmitting(false);

    if (!result.ok) {
      toast({ title: "Error", description: result.message, variant: "destructive" });
      return;
    }

    toast({ title: "Order created" });
    router.push(`/${organizationSlug}/orders/${result.data.orderId}`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New order</h1>
        <p className="text-muted-foreground">Create a manual order for a customer</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-lg border p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Order lines</h2>
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <Plus className="mr-2 h-4 w-4" />
                Add line
              </Button>
            </div>
            <div className="space-y-4">
              {lines.map((line) => (
                <div key={line.key} className="space-y-3 rounded-md border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">Product</Label>
                      <Select value={line.productId} onValueChange={(value) => updateLine(line.key, { productId: value })}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select product" />
                        </SelectTrigger>
                        <SelectContent>
                          {products.map((product) => (
                            <SelectItem key={product.id} value={product.id}>
                              {product.categoryName} · {product.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mt-5"
                      onClick={() => removeLine(line.key)}
                      disabled={lines.length === 1}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="space-y-1">
                      <Label className="text-xs">Mode</Label>
                      <Select
                        value={line.mode}
                        onValueChange={(value) => updateLine(line.key, { mode: value as OrderItemMode })}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="piece">Piece</SelectItem>
                          <SelectItem value="kg">Kg</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Quantity</Label>
                      <Input
                        type="number"
                        step={line.mode === "piece" ? 1 : 0.1}
                        min={line.mode === "piece" ? 1 : 0.1}
                        value={line.quantity}
                        onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Size min (kg)</Label>
                      <Input
                        type="number"
                        step={0.1}
                        min={0.1}
                        value={line.sizeMinKg}
                        onChange={(e) => updateLine(line.key, { sizeMinKg: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Size max (kg)</Label>
                      <Input
                        type="number"
                        step={0.1}
                        min={0.1}
                        value={line.sizeMaxKg}
                        onChange={(e) => updateLine(line.key, { sizeMaxKg: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">If size unavailable</Label>
                    <Select
                      value={line.fallback}
                      onValueChange={(value) => updateLine(line.key, { fallback: value as OrderFallback })}
                    >
                      <SelectTrigger className="w-full sm:w-64">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FALLBACKS.map((fallback) => (
                          <SelectItem key={fallback} value={fallback}>
                            {FALLBACK_LABELS[fallback]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4 rounded-lg border p-4">
            <h2 className="font-semibold">Delivery</h2>
            <div className="space-y-1">
              <Label className="text-xs">Zone</Label>
              <Select value={zoneId} onValueChange={handleZoneChange}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select zone" />
                </SelectTrigger>
                <SelectContent>
                  {zones.map((zone) => (
                    <SelectItem key={zone.id} value={zone.id}>
                      {zone.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {zoneId && (
              <div className="space-y-1">
                <Label className="text-xs">Delivery date &amp; slot</Label>
                <Select value={selectedOptionKey} onValueChange={setSelectedOptionKey}>
                  <SelectTrigger className="w-full">
                    <SelectValue
                      placeholder={deliveryOptions.length === 0 ? "No slots available" : "Select a date and slot"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {deliveryOptions.map((option) => (
                      <SelectItem key={`${option.slotId}-${option.date}`} value={`${option.slotId}-${option.date}`}>
                        {option.date} · {option.truckName} {option.startTime}–{option.endTime}
                        {option.remaining != null ? ` (${option.remaining} left)` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs">Delivery address</Label>
              <Textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address" />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Order notes..." />
            </div>
          </div>
        </div>

        <div className="space-y-4">
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
                          type="button"
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
                <Button variant="outline" className="mt-2 w-full" onClick={() => setNewCustomerMode(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  New customer
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
                  <Button onClick={handleAddNewCustomer}>Save customer</Button>
                </div>
              </div>
            )}
          </div>

          <Button className="w-full" size="lg" disabled={submitting} onClick={submitOrder}>
            {submitting ? "Creating…" : "Create order"}
          </Button>
        </div>
      </div>
    </div>
  );
}
