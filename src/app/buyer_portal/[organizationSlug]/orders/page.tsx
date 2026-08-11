import Link from "next/link";
import { requireBuyerOrRedirect } from "@/lib/auth/buyer-auth";
import { getMyOrders } from "@/features/orders/server/portal-actions";
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from "@/features/orders/types";
import { formatPrice } from "@/features/orders/lib/order-model";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Package, ArrowLeft } from "lucide-react";

type OrdersPageProps = {
  params: Promise<{ organizationSlug: string }>;
};

export default async function OrdersPage({ params }: OrdersPageProps) {
  const { organizationSlug } = await params;
  await requireBuyerOrRedirect(organizationSlug);
  const result = await getMyOrders();

  if (!result.ok) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-muted-foreground">Failed to load orders.</p>
      </div>
    );
  }

  const orders = result.data;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/buyer_portal/${organizationSlug}/shop`}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Orders</h1>
          <p className="text-muted-foreground">View your order history</p>
        </div>
      </div>

      {orders.length === 0 ? (
        <Card>
          <CardContent className="flex min-h-[300px] flex-col items-center justify-center py-12">
            <Package className="mb-4 h-16 w-16 text-muted-foreground" />
            <h2 className="text-xl font-semibold">No orders yet</h2>
            <p className="mt-2 text-muted-foreground">
              Start shopping to see your orders here.
            </p>
            <Button asChild className="mt-6">
              <Link href={`/buyer_portal/${organizationSlug}/shop`}>Browse Products</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {orders.map((order) => (
            <Card key={order.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">
                      Order #{order.id.slice(0, 8)}
                    </CardTitle>
                    <CardDescription>
                      {format(new Date(order.created_at), "d MMM yyyy, HH:mm")}
                      {order.zone?.name ? ` · ${order.zone.name}` : ""}
                    </CardDescription>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      ORDER_STATUS_COLORS[order.status]
                    }`}
                  >
                    {ORDER_STATUS_LABELS[order.status]}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Delivery:{" "}
                      {format(new Date(`${order.delivery_date}T00:00:00`), "d MMM yyyy")}
                    </p>
                    {order.delivery_address && (
                      <p className="mt-1 max-w-md truncate text-sm text-muted-foreground">
                        {order.delivery_address}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold">
                      {order.status === "closed"
                        ? formatPrice(Number(order.total_amount))
                        : "Priced at close"}
                    </p>
                    <Button variant="outline" size="sm" asChild className="mt-2">
                      <Link href={`/buyer_portal/${organizationSlug}/orders/${order.id}`}>
                        View Details
                      </Link>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
