import Link from "next/link";
import { requireBuyerOrRedirect } from "@/lib/auth/buyer-auth";
import { getMyOrders } from "@/features/orders/server/portal-actions";
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from "@/features/orders/types";
import { formatPrice } from "@/features/orders/lib/order-model";
import { OrderTracker } from "@/features/buyer/components/order-tracker";
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
        <p className="text-muted-foreground">Gagal memuatkan pesanan.</p>
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
          <h1 className="font-buyer-display text-3xl font-bold">Pesanan Saya</h1>
          <p className="text-muted-foreground">Sejarah pesanan anda</p>
        </div>
      </div>

      {orders.length === 0 ? (
        <Card>
          <CardContent className="flex min-h-[300px] flex-col items-center justify-center py-12">
            <Package className="mb-4 h-16 w-16 text-muted-foreground" />
            <h2 className="text-xl font-semibold">Belum ada pesanan</h2>
            <p className="mt-2 text-muted-foreground">Jom mula membeli!</p>
            <Button asChild className="mt-6">
              <Link href={`/buyer_portal/${organizationSlug}/shop`}>Lihat produk</Link>
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
                      Pesanan #{order.id.slice(0, 8)}
                    </CardTitle>
                    <CardDescription>
                      {format(new Date(order.created_at), "d MMM yyyy, HH:mm")}
                      {order.zone?.name ? ` · ${order.zone.name}` : ""}
                    </CardDescription>
                  </div>
                  {order.status === "cancelled" && (
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        ORDER_STATUS_COLORS[order.status]
                      }`}
                    >
                      {ORDER_STATUS_LABELS[order.status]}
                    </span>
                  )}
                </div>
                <OrderTracker status={order.status} />
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Hantar:{" "}
                      {format(new Date(`${order.delivery_date}T00:00:00`), "d MMM yyyy")}
                    </p>
                    {order.delivery_address && (
                      <p className="mt-1 max-w-md truncate text-sm text-muted-foreground">
                        {order.delivery_address}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    {order.status === "closed" ? (
                      <p className="font-buyer-mono text-lg font-bold">{formatPrice(Number(order.total_amount))}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground">Harga selepas timbang</p>
                    )}
                    <Button variant="outline" size="sm" asChild className="mt-2">
                      <Link href={`/buyer_portal/${organizationSlug}/orders/${order.id}`}>
                        Lihat butiran
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
