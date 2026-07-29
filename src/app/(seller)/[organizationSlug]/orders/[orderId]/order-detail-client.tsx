"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateOrderStatus } from "@/features/seller/server/actions";
import type { Order, OrderItem, OrderStatus } from "@/features/seller/types";
import { ORDER_STATUS_LABELS } from "@/features/seller/types";
import { formatQuantity, formatVariantPrice } from "@/features/seller/lib/pricing";
import type { UnitType } from "@/features/seller/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type OrderWithDetails = Order & {
  customer: { name: string; phone: string; address: string | null; notes: string | null };
  items: (OrderItem & { variant: { name: string; price_per_unit: number; product: { name: string }; unit_type: string } })[];
};

type OrderDetailClientProps = {
  organizationSlug: string;
  initialOrder: OrderWithDetails | null;
};

const STATUS_COLORS: Record<OrderStatus, string> = {
  new: "bg-blue-100 text-blue-800",
  preparing: "bg-yellow-100 text-yellow-800",
  ready: "bg-green-100 text-green-800",
  completed: "bg-gray-100 text-gray-800",
  cancelled: "bg-red-100 text-red-800",
};

const NEXT_STATUS: Partial<Record<OrderStatus, { status: OrderStatus; label: string }>> = {
  new: { status: "preparing", label: "Start Preparing" },
  preparing: { status: "ready", label: "Mark Ready" },
  ready: { status: "completed", label: "Mark Completed" },
};

export function OrderDetailClient({ organizationSlug, initialOrder }: OrderDetailClientProps) {
  const { toast } = useToast();
  const router = useRouter();
  const [order, setOrder] = useState(initialOrder);

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">Order not found</p>
        <Button variant="outline" onClick={() => router.push(`/${organizationSlug}/orders`)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Orders
        </Button>
      </div>
    );
  }

  const handleStatusUpdate = async (newStatus: OrderStatus) => {
    try {
      await updateOrderStatus(order.id, newStatus);
      setOrder({ ...order, status: newStatus });
      toast({ title: `Order status updated to ${ORDER_STATUS_LABELS[newStatus]}` });
    } catch (error) {
      toast({ title: "Error", description: String(error), variant: "destructive" });
    }
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleString("en-MY", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat("en-MY", {
      style: "currency",
      currency: "MYR",
    }).format(amount);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push(`/${organizationSlug}/orders`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Order Details</h1>
          <p className="text-muted-foreground">
            Order #{order.id.slice(0, 8).toUpperCase()}
          </p>
        </div>
        <Badge className={STATUS_COLORS[order.status as OrderStatus]}>
          {ORDER_STATUS_LABELS[order.status as OrderStatus]}
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* Items */}
          <div className="rounded-lg border">
            <div className="border-b px-6 py-4">
              <h2 className="font-semibold">Order Items</h2>
            </div>
            <div className="divide-y">
              {order.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between px-6 py-4">
                  <div>
                    <div className="font-medium">{item.variant?.product?.name || "Unknown Product"}</div>
                    <div className="text-sm text-muted-foreground">
                      {item.variant?.name || "Unknown Variant"} ·{" "}
                      {formatQuantity(
                        Number(item.quantity),
                        (item.variant?.unit_type ?? "per_piece") as UnitType,
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium">{formatPrice(Number(item.subtotal))}</div>
                    <div className="text-sm text-muted-foreground">
                      {formatVariantPrice(
                        Number(item.unit_price),
                        (item.variant?.unit_type ?? "per_piece") as UnitType,
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t px-6 py-4">
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span>{formatPrice(Number(order.total_amount))}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          {order.notes && (
            <div className="rounded-lg border">
              <div className="border-b px-6 py-4">
                <h2 className="font-semibold">Order Notes</h2>
              </div>
              <div className="px-6 py-4">
                <p className="text-muted-foreground">{order.notes}</p>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          {/* Customer */}
          <div className="rounded-lg border p-6">
            <h2 className="mb-4 font-semibold">Customer</h2>
            <div className="space-y-2">
              <div className="font-medium">{order.customer?.name || "Unknown"}</div>
              <div className="text-sm text-muted-foreground">{order.customer?.phone || "-"}</div>
              {order.customer?.address && (
                <div className="text-sm text-muted-foreground">{order.customer.address}</div>
              )}
              {order.customer?.notes && (
                <div className="mt-2 rounded-md bg-muted p-2 text-sm">
                  {order.customer.notes}
                </div>
              )}
            </div>
          </div>

          {/* Timeline */}
          <div className="rounded-lg border p-6">
            <h2 className="mb-4 font-semibold">Timeline</h2>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="mt-1 h-2 w-2 rounded-full bg-blue-500" />
                <div>
                  <div className="font-medium">Order Created</div>
                  <div className="text-sm text-muted-foreground">{formatDate(order.created_at)}</div>
                </div>
              </div>
              {order.status !== "new" && (
                <div className="flex items-start gap-3">
                  <div className="mt-1 h-2 w-2 rounded-full bg-yellow-500" />
                  <div>
                    <div className="font-medium">Started Preparing</div>
                    <div className="text-sm text-muted-foreground">{formatDate(order.updated_at)}</div>
                  </div>
                </div>
              )}
              {(order.status === "ready" || order.status === "completed") && (
                <div className="flex items-start gap-3">
                  <div className="mt-1 h-2 w-2 rounded-full bg-green-500" />
                  <div>
                    <div className="font-medium">Ready for Pickup</div>
                    <div className="text-sm text-muted-foreground">{formatDate(order.updated_at)}</div>
                  </div>
                </div>
              )}
              {order.status === "completed" && (
                <div className="flex items-start gap-3">
                  <div className="mt-1 h-2 w-2 rounded-full bg-gray-500" />
                  <div>
                    <div className="font-medium">Completed</div>
                    <div className="text-sm text-muted-foreground">{formatDate(order.updated_at)}</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          {NEXT_STATUS[order.status as OrderStatus] && (
            <Button
              className="w-full"
              size="lg"
              onClick={() => handleStatusUpdate(NEXT_STATUS[order.status as OrderStatus]!.status)}
            >
              {NEXT_STATUS[order.status as OrderStatus]!.label}
            </Button>
          )}
          {order.status !== "completed" && order.status !== "cancelled" && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => handleStatusUpdate("cancelled")}
            >
              Cancel Order
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
