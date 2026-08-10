"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2, Minus, Plus, ShoppingCart, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCart } from "@/features/buyer/components/cart-context";
import { FALLBACK_LABELS } from "@/features/orders/types";

type CartPageProps = {
  params: Promise<{ organizationSlug: string }>;
};

export default function CartPage({ params }: CartPageProps) {
  const router = useRouter();
  const { items, updateLine, removeLine } = useCart();
  const [organizationSlug, setOrganizationSlug] = useState<string>("");

  useEffect(() => {
    params.then((p) => setOrganizationSlug(p.organizationSlug));
  }, [params]);

  const handleCheckout = () => {
    if (items.length === 0) return;
    router.push(`/buyer_portal/${organizationSlug}/checkout`);
  };

  if (items.length === 0) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
        <ShoppingCart className="mb-4 h-16 w-16 text-muted-foreground" />
        <h1 className="text-2xl font-bold">Your cart is empty</h1>
        <p className="mt-2 text-muted-foreground">
          Add some products to get started!
        </p>
        <Button asChild className="mt-6">
          <Link href={`/buyer_portal/${organizationSlug}/shop`}>Browse Products</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-8 text-3xl font-bold">Shopping Cart</h1>

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Items ({items.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {items.map((item, index) => {
                const step = item.mode === "kg" ? 0.1 : 1;
                const min = item.mode === "kg" ? 0.1 : 1;
                return (
                  <div
                    key={`${item.productId}-${index}`}
                    className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0"
                  >
                    <div className="flex-1">
                      <p className="font-medium">{item.productName}</p>
                      <p className="text-sm text-muted-foreground">
                        {item.sizeMinKg}-{item.sizeMaxKg} kg / bird
                      </p>
                      <Badge variant="outline" className="mt-1">
                        {FALLBACK_LABELS[item.fallback]}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() =>
                            updateLine(index, {
                              quantity: Math.max(
                                min,
                                Math.round((item.quantity - step) * 1000) / 1000,
                              ),
                            })
                          }
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <span
                          className={
                            item.mode === "kg" ? "w-16 text-center" : "w-8 text-center"
                          }
                        >
                          {item.mode === "kg" ? `${item.quantity} kg` : item.quantity}
                        </span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() =>
                            updateLine(index, {
                              quantity: Math.round((item.quantity + step) * 1000) / 1000,
                            })
                          }
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => removeLine(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="sticky top-20">
            <CardHeader>
              <CardTitle>Ready to order?</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Pricing is confirmed after your order is weighed and closed —
                pick a delivery slot next.
              </p>
            </CardContent>
            <CardFooter className="flex flex-col gap-2">
              <Button className="w-full" size="lg" onClick={handleCheckout}>
                Proceed to Checkout
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button variant="outline" className="w-full" asChild>
                <Link href={`/buyer_portal/${organizationSlug}/shop`}>
                  Continue Shopping
                </Link>
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
