import { redirect } from "next/navigation";
import Link from "next/link";
import { requireBuyerOrRedirect } from "@/lib/auth/buyer-auth";
import { getBuyerOrders } from "@/features/buyer/server/actions";
import { orderStatusLabels, orderStatusColors, BuyerOrderListItem } from "@/features/buyer/types";
import { formatDistanceToNow } from "date-fns";
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
  const buyer = await requireBuyerOrRedirect(organizationSlug);
  const result = await getBuyerOrders();

  if (!result.ok) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-muted-foreground">Failed to load orders.</p>
      </div>
    );
  }

  const orders = result.data as BuyerOrderListItem[];

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("en-MY", {
      style: "currency",
      currency: "MYR",
    }).format(price);
  };

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
                      {formatDistanceToNow(new Date(order.created_at), {
                        addSuffix: true,
                      })}
                    </CardDescription>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      orderStatusColors[order.status]
                    }`}
                  >
                    {orderStatusLabels[order.status]}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {order.items?.length || 0} items
                    </p>
                    {order.delivery_address && (
                      <p className="mt-1 max-w-md truncate text-sm text-muted-foreground">
                        Delivery: {order.delivery_address}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold">
                      {formatPrice(Number(order.total_amount))}
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
