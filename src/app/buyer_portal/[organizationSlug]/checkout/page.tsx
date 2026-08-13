"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { useCart } from "@/features/buyer/components/cart-context";
import {
  getActiveZones,
  getDeliveryOptions,
  placeOrder,
} from "@/features/orders/server/portal-actions";
import type { DeliveryZone, DeliveryOption } from "@/features/orders/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle } from "lucide-react";

type CheckoutPageProps = {
  params: Promise<{ organizationSlug: string }>;
};

function optionKey(option: DeliveryOption) {
  return `${option.date}-${option.slotId}`;
}

export default function CheckoutPage({ params }: CheckoutPageProps) {
  const router = useRouter();
  const { items, clearCart } = useCart();
  const { toast } = useToast();

  const [organizationSlug, setOrganizationSlug] = useState<string>("");
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [zonesLoading, setZonesLoading] = useState(true);
  const [zoneId, setZoneId] = useState<string>("");
  const [options, setOptions] = useState<DeliveryOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [address, setAddress] = useState("");
  const [postcode, setPostcode] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [orderComplete, setOrderComplete] = useState(false);
  const [orderId, setOrderId] = useState<string>("");

  useEffect(() => {
    params.then((p) => setOrganizationSlug(p.organizationSlug));
  }, [params]);

  useEffect(() => {
    if (!organizationSlug) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setZonesLoading(true);
    getActiveZones(organizationSlug).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setZones(result.data);
      }
      setZonesLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [organizationSlug]);

  useEffect(() => {
    if (!organizationSlug || !zoneId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOptions([]);
      setSelectedKey("");
      return;
    }
    let cancelled = false;
    setOptionsLoading(true);
    setSelectedKey("");
    getDeliveryOptions(organizationSlug, zoneId).then((result) => {
      if (cancelled) return;
      setOptions(result.ok ? result.data : []);
      setOptionsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [organizationSlug, zoneId]);

  const groupedOptions = useMemo(() => {
    const groups = new Map<string, DeliveryOption[]>();
    for (const option of options) {
      const list = groups.get(option.date) ?? [];
      list.push(option);
      groups.set(option.date, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [options]);

  const selectedOption = options.find((o) => optionKey(o) === selectedKey) ?? null;

  const canSubmit =
    items.length > 0 &&
    zoneId !== "" &&
    address.trim().length > 0 &&
    selectedOption !== null &&
    !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !selectedOption) return;

    setSubmitting(true);
    const result = await placeOrder({
      organizationSlug,
      zoneId,
      slotId: selectedOption.slotId,
      deliveryDate: selectedOption.date,
      address: address.trim(),
      postcode: postcode.trim() || undefined,
      notes: notes.trim() || undefined,
      items: items.map((item) => ({
        productId: item.productId,
        mode: item.mode,
        quantity: item.quantity,
        sizeMinKg: item.sizeMinKg,
        sizeMaxKg: item.sizeMaxKg,
        fallback: item.fallback,
      })),
    });
    setSubmitting(false);

    if (!result.ok) {
      toast({
        title: "Order failed",
        description: result.message,
        variant: "destructive",
      });
      return;
    }

    setOrderId(result.data.orderId);
    setOrderComplete(true);
    clearCart();

    toast({
      title: "Order placed!",
      description: "Your order has been successfully placed.",
    });
  };

  if (orderComplete) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Card className="mx-auto max-w-md text-center">
          <CardHeader>
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <CardTitle className="text-2xl">Order Placed!</CardTitle>
            <CardDescription>
              Thank you for your order. We will process it shortly.
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              Order ID: {orderId.slice(0, 8)}...
            </p>
            <Button
              className="w-full"
              onClick={() => router.push(`/buyer_portal/${organizationSlug}/orders`)}
            >
              View My Orders
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => router.push(`/buyer_portal/${organizationSlug}/shop`)}
            >
              Continue Shopping
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
        <h1 className="text-2xl font-bold">Your cart is empty</h1>
        <p className="mt-2 text-muted-foreground">
          Add some products to get started!
        </p>
        <Button asChild className="mt-6">
          <a href={`/buyer_portal/${organizationSlug}/shop`}>Browse Products</a>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-8 text-3xl font-bold">Checkout</h1>

      <form onSubmit={handleSubmit}>
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Delivery Details</CardTitle>
                <CardDescription>
                  Pick your delivery zone, address, and a time slot.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="zone">Delivery Zone</Label>
                  <Select
                    value={zoneId}
                    onValueChange={(v) => setZoneId(v)}
                    disabled={zonesLoading || zones.length === 0}
                  >
                    <SelectTrigger id="zone" className="w-full">
                      <SelectValue
                        placeholder={zonesLoading ? "Loading zones..." : "Select a zone"}
                      />
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

                <div className="space-y-2">
                  <Label htmlFor="address">Delivery Address</Label>
                  <Textarea
                    id="address"
                    placeholder="Enter your full delivery address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    rows={3}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="postcode">Postcode (Optional)</Label>
                  <Input
                    id="postcode"
                    placeholder="5-digit postcode"
                    value={postcode}
                    onChange={(e) => setPostcode(e.target.value.replace(/\D/g, "").slice(0, 5))}
                    inputMode="numeric"
                    maxLength={5}
                    className="max-w-[10rem]"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notes">Order Notes (Optional)</Label>
                  <Textarea
                    id="notes"
                    placeholder="Any special instructions for your order?"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Delivery Slot</CardTitle>
                <CardDescription>
                  {zoneId === ""
                    ? "Select a zone to see delivery dates and times."
                    : "Choose a date and truck time window."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {zoneId !== "" && optionsLoading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading delivery options...
                  </div>
                )}
                {zoneId !== "" && !optionsLoading && groupedOptions.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No delivery available for this area yet.
                  </p>
                )}
                {!optionsLoading && groupedOptions.length > 0 && (
                  <div className="space-y-4" role="radiogroup" aria-label="Delivery slot">
                    {groupedOptions.map(([date, dateOptions]) => (
                      <div key={date}>
                        <p className="mb-2 text-sm font-medium">
                          {format(new Date(`${date}T00:00:00`), "EEEE, d MMM yyyy")}
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {dateOptions.map((option) => {
                            const key = optionKey(option);
                            const isSelected = key === selectedKey;
                            return (
                              <button
                                key={key}
                                type="button"
                                role="radio"
                                aria-checked={isSelected}
                                onClick={() => setSelectedKey(key)}
                                className={`rounded-2xl border p-3 text-left text-sm transition-colors ${
                                  isSelected
                                    ? "border-primary bg-primary/5"
                                    : "border-border hover:bg-muted"
                                }`}
                              >
                                <p className="font-medium">{option.truckName}</p>
                                <p className="text-muted-foreground">
                                  {option.startTime.slice(0, 5)}–{option.endTime.slice(0, 5)}
                                </p>
                                {option.remaining !== null && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {option.remaining} slot{option.remaining === 1 ? "" : "s"} left
                                  </p>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div>
            <Card className="sticky top-20">
              <CardHeader>
                <CardTitle>Place Order</CardTitle>
                <CardDescription>
                  {items.length} item{items.length === 1 ? "" : "s"} in your
                  cart. Final pricing is set per kg when your order closes.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {items.map((item, index) => (
                  <div key={`${item.productId}-${index}`} className="flex justify-between text-sm">
                    <span>
                      {item.productName} ×{" "}
                      {item.mode === "kg" ? `${item.quantity} kg` : item.quantity}
                    </span>
                  </div>
                ))}
              </CardContent>
              <CardFooter>
                <Button type="submit" className="w-full" size="lg" disabled={!canSubmit}>
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Placing Order...
                    </>
                  ) : (
                    "Place Order"
                  )}
                </Button>
              </CardFooter>
            </Card>
          </div>
        </div>
      </form>
    </div>
  );
}
