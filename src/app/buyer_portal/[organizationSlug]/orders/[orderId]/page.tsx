import { notFound } from "next/navigation";
import Link from "next/link";
import { requireBuyerOrRedirect } from "@/lib/auth/buyer-auth";
import { getBuyerOrderWithItems } from "@/features/buyer/server/actions";
import { orderStatusLabels, orderStatusColors } from "@/features/buyer/types";
import { formatDistanceToNow, format } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Package,
  MapPin,
  FileText,
  ArrowLeft,
  CheckCircle,
  Clock,
  ChefHat,
  Bell,
  XCircle,
  type LucideIcon,
} from "lucide-react";

type OrderDetailPageProps = {
  params: Promise<{ organizationSlug: string; orderId: string }>;
};

const statusIcons: Record<string, LucideIcon> = {
  new: Package,
  preparing: ChefHat,
  ready: Bell,
  completed: CheckCircle,
  cancelled: XCircle,
};

const statusSteps = ["new", "preparing", "ready", "completed"];

export default async function OrderDetailPage({
  params,
}: OrderDetailPageProps) {
  const { organizationSlug, orderId } = await params;
  await requireBuyerOrRedirect(organizationSlug);

  const result = await getBuyerOrderWithItems(orderId);

  if (!result.ok || !result.data) {
    notFound();
  }

  const order = result.data;

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("en-MY", {
      style: "currency",
      currency: "MYR",
    }).format(price);
  };

  const currentStepIndex = statusSteps.indexOf(order.status);
  const isCancelled = order.status === "cancelled";

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/buyer_portal/${organizationSlug}/orders`}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Order Details</h1>
          <p className="text-muted-foreground">
            Order #{order.id.slice(0, 8)}
          </p>
        </div>
      </div>

      {/* Order Status */}
      <Card>
        <CardHeader>
          <CardTitle>Order Status</CardTitle>
          <CardDescription>
            {format(new Date(order.created_at), "PPpp")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <span
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                orderStatusColors[order.status]
              }`}
            >
              {orderStatusLabels[order.status]}
            </span>
          </div>

          {/* Status Timeline */}
          {!isCancelled && (
            <div className="mt-6">
              <div className="flex items-center justify-between">
                {statusSteps.map((step, index) => {
                  const Icon = statusIcons[step] ?? Package;
                  const isCompleted = index <= currentStepIndex;
                  const isCurrent = index === currentStepIndex;

                  return (
                    <div key={step} className="flex flex-1 flex-col items-center">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-full ${
                          isCompleted
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground"
                        } ${isCurrent ? "ring-4 ring-primary/20" : ""}`}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <span
                        className={`mt-2 text-xs font-medium ${
                          isCompleted ? "text-primary" : "text-muted-foreground"
                        }`}
                      >
                        {orderStatusLabels[step as keyof typeof orderStatusLabels]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {isCancelled && (
            <div className="mt-4 rounded-lg bg-red-50 p-4 text-red-800">
              <p>This order has been cancelled.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Order Items */}
      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {order.items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0"
              >
                <div>
                  <p className="font-medium">
                    {item.variant?.product?.name || "Unknown Product"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {item.variant?.name} x {item.quantity}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium">
                    {formatPrice(Number(item.subtotal))}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {formatPrice(Number(item.unit_price))} each
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 border-t pt-4">
            <div className="flex justify-between text-lg font-bold">
              <span>Total</span>
              <span>{formatPrice(Number(order.total_amount))}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Delivery & Notes */}
      <div className="grid gap-6 md:grid-cols-2">
        {order.delivery_address && (
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <MapPin className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">Delivery Address</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">{order.delivery_address}</p>
            </CardContent>
          </Card>
        )}

        {order.notes && (
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">Order Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">{order.notes}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
