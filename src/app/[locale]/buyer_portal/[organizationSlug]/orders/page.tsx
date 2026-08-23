import { Link } from "@/i18n/navigation";
import { getTranslations, getFormatter, setRequestLocale } from "next-intl/server";
import { requireBuyerOrRedirect } from "@/lib/auth/buyer-auth";
import { getMyOrders } from "@/features/orders/server/portal-actions";
import { ORDER_STATUS_COLORS } from "@/features/orders/types";
import { formatPrice } from "@/features/orders/lib/order-model";
import { OrderTracker } from "@/features/buyer/components/order-tracker";
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
  params: Promise<{ locale: string; organizationSlug: string }>;
};

export default async function OrdersPage({ params }: OrdersPageProps) {
  const { locale, organizationSlug } = await params;
  // Required alongside the `[locale]` layout's own call - see the comment on
  // ShopPage for why every page needs this, not just the layout.
  setRequestLocale(locale);
  await requireBuyerOrRedirect(organizationSlug);
  const result = await getMyOrders();
  const t = await getTranslations("buyer.orders");
  const tHeader = await getTranslations("buyer.header");
  const tCart = await getTranslations("buyer.cart");
  const tPricing = await getTranslations("buyer.pricing");
  const tStatus = await getTranslations("status");
  const format = await getFormatter();

  if (!result.ok) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-muted-foreground">{t("errorLoad")}</p>
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
          <h1 className="font-buyer-display text-3xl font-bold">{tHeader("myOrders")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      {orders.length === 0 ? (
        <Card>
          <CardContent className="flex min-h-[300px] flex-col items-center justify-center py-12">
            <Package className="mb-4 h-16 w-16 text-muted-foreground" />
            <h2 className="text-xl font-semibold">{t("emptyTitle")}</h2>
            <p className="mt-2 text-muted-foreground">{t("emptyBody")}</p>
            <Button asChild className="mt-6">
              <Link href={`/buyer_portal/${organizationSlug}/shop`}>
                {tCart("viewProducts")}
              </Link>
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
                      {t("orderNumber", { id: order.id.slice(0, 8) })}
                    </CardTitle>
                    <CardDescription>
                      {format.dateTime(new Date(order.created_at), {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                      {order.zone?.name ? ` · ${order.zone.name}` : ""}
                    </CardDescription>
                  </div>
                  {order.status === "cancelled" && (
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        ORDER_STATUS_COLORS[order.status]
                      }`}
                    >
                      {tStatus(`order.${order.status}`)}
                    </span>
                  )}
                </div>
                <OrderTracker status={order.status} />
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t("deliveryPrefix")}{" "}
                      {format.dateTime(new Date(`${order.delivery_date}T00:00:00`), {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
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
                      <p className="text-sm text-muted-foreground">
                        {tPricing("afterWeighing")}
                      </p>
                    )}
                    <Button variant="outline" size="sm" asChild className="mt-2">
                      <Link href={`/buyer_portal/${organizationSlug}/orders/${order.id}`}>
                        {t("viewDetails")}
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
