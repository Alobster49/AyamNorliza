"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/features/buyer/components/cart-context";
import { createBuyerOrder } from "@/features/buyer/server/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

type CartItemWithDetails = {
  variantId: string;
  quantity: number;
  name: string;
  price: number;
  unitType: "per_kg" | "per_piece";
  productName: string;
};

export default function CheckoutPage({ params }: CheckoutPageProps) {
  const router = useRouter();
  const { items, clearCart } = useCart();
  const { toast } = useToast();
  const [cartItems, setCartItems] = useState<CartItemWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [organizationSlug, setOrganizationSlug] = useState<string>("");
  const [orderComplete, setOrderComplete] = useState(false);
  const [orderId, setOrderId] = useState<string>("");

  const [formData, setFormData] = useState({
    deliveryAddress: "",
    notes: "",
  });

  useEffect(() => {
    params.then((p) => setOrganizationSlug(p.organizationSlug));
  }, [params]);

  // Fetch variant details
  useEffect(() => {
    async function fetchCartDetails() {
      if (items.length === 0) {
        setCartItems([]);
        setLoading(false);
        return;
      }

      try {
        const variantIds = items.map((i) => i.variantId);
        const response = await fetch(
          `/api/buyer/cart?variantIds=${variantIds.join(",")}`,
        );
        if (!response.ok) throw new Error("Failed to fetch");

        const data = await response.json();
        const itemsMap = new Map(items.map((i) => [i.variantId, i.quantity]));

        setCartItems(
          data.variants.map((v: any) => ({
            variantId: v.id,
            quantity: itemsMap.get(v.id) || 1,
            name: v.name,
            price: Number(v.price_per_unit),
            unitType: v.unit_type === "per_kg" ? "per_kg" : "per_piece",
            productName: v.product?.name || "Unknown Product",
          })),
        );
      } catch (error) {
        console.error("Error fetching cart details:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchCartDetails();
  }, [items]);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("en-MY", {
      style: "currency",
      currency: "MYR",
    }).format(price);
  };

  const subtotal = cartItems.reduce(
    (sum, item) => sum + Math.round(item.price * item.quantity * 100) / 100,
    0,
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (cartItems.length === 0) {
      toast({
        title: "Cart is empty",
        description: "Add some items to your cart first.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);

    const result = await createBuyerOrder({
      items: cartItems.map((item) => ({
        variantId: item.variantId,
        quantity: item.quantity,
      })),
      deliveryAddress: formData.deliveryAddress || undefined,
      notes: formData.notes || undefined,
    });

    setSubmitting(false);

    if (!result.ok) {
      toast({
        title: "Order failed",
        description: result.message || "Failed to place order. Please try again.",
        variant: "destructive",
      });
      return;
    }

    setOrderId(result.data.id);
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

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (cartItems.length === 0) {
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
          {/* Delivery Details */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Delivery Details</CardTitle>
                <CardDescription>
                  Provide your delivery address and any special instructions.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="address" className="text-sm font-medium">
                    Delivery Address
                  </label>
                  <Textarea
                    id="address"
                    placeholder="Enter your full delivery address"
                    value={formData.deliveryAddress}
                    onChange={(e) =>
                      setFormData({ ...formData, deliveryAddress: e.target.value })
                    }
                    rows={3}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="notes" className="text-sm font-medium">
                    Order Notes (Optional)
                  </label>
                  <Textarea
                    id="notes"
                    placeholder="Any special instructions for your order?"
                    value={formData.notes}
                    onChange={(e) =>
                      setFormData({ ...formData, notes: e.target.value })
                    }
                    rows={2}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Order Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {cartItems.map((item) => (
                  <div
                    key={item.variantId}
                    className="flex justify-between text-sm"
                  >
                    <span>
                      {item.productName} - {item.name} ×{" "}
                      {item.unitType === "per_kg" ? `${item.quantity} kg` : item.quantity}
                    </span>
                    <span>{formatPrice(Math.round(item.price * item.quantity * 100) / 100)}</span>
                  </div>
                ))}
                <div className="border-t pt-2 mt-2">
                  <div className="flex justify-between font-semibold">
                    <span>Total</span>
                    <span>{formatPrice(subtotal)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Place Order */}
          <div>
            <Card className="sticky top-20">
              <CardHeader>
                <CardTitle>Place Order</CardTitle>
                <CardDescription>
                  Review your order and click Place Order to confirm.
                </CardDescription>
              </CardHeader>
              <CardFooter>
                <Button
                  type="submit"
                  className="w-full"
                  size="lg"
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Placing Order...
                    </>
                  ) : (
                    <>Place Order - {formatPrice(subtotal)}</>
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
