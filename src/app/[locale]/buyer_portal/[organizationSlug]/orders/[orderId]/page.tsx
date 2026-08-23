import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getTranslations, getFormatter, setRequestLocale } from "next-intl/server";
import { requireBuyerOrRedirect } from "@/lib/auth/buyer-auth";
import { getMyOrder } from "@/features/orders/server/portal-actions";
import { ORDER_STATUS_COLORS } from "@/features/orders/types";
import { formatPrice, describeFallback } from "@/features/orders/lib/order-model";
import { BUYER_FALLBACK_LABELS } from "@/features/buyer/lib/price-estimate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MapPin, FileText, ArrowLeft } from "lucide-react";
import { CancelOrderButton } from "./cancel-order-button";
import { OrderTracker } from "@/features/buyer/components/order-tracker";
import { ScaleChip } from "@/features/buyer/components/scale-chip";

type OrderDetailPageProps = {
  params: Promise<{ locale: string; organizationSlug: string; orderId: string }>;
};

export default async function OrderDetailPage({ params }: OrderDetailPageProps) {
  const { locale, organizationSlug, orderId } = await params;
  // Required alongside the `[locale]` layout's own call - see the comment on
  // ShopPage for why every page needs this, not just the layout.
  setRequestLocale(locale);
  await requireBuyerOrRedirect(organizationSlug);

  const result = await getMyOrder(orderId);

  if (!result.ok) {
    notFound();
  }

  const order = result.data;
  const isClosed = order.status === "closed";
  const t = await getTranslations("buyer.orderDetail");
  const tOrders = await getTranslations("buyer.orders");
  const tCart = await getTranslations("buyer.cart");
  const tStatus = await getTranslations("status");
  const format = await getFormatter();

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/buyer_portal/${organizationSlug}/orders`}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="font-buyer-display text-3xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">
            {tOrders("orderNumber", { id: order.id.slice(0, 8) })}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("statusCardTitle")}</CardTitle>
          <CardDescription>
            {t("bookedAt", {
              date: format.dateTime(new Date(order.created_at), {
                dateStyle: "medium",
                timeStyle: "short",
              }),
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            {order.status === "cancelled" ? (
              <span
                className={`rounded-full px-4 py-2 text-sm font-medium ${
                  ORDER_STATUS_COLORS[order.status]
                }`}
              >
                {tStatus(`order.${order.status}`)}
              </span>
            ) : (
              <OrderTracker status={order.status} />
            )}
            {order.status === "pending" && (
              <CancelOrderButton organizationSlug={organizationSlug} orderId={order.id} />
            )}
          </div>

          {order.status === "cancelled" && order.notes && (
            <div className="rounded-lg bg-red-50 p-4 text-sm text-red-800">
              <p className="font-medium">{t("cancelledNotice")}</p>
              <p className="mt-1 whitespace-pre-line">{order.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("itemsCardTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {order.items.map((item) => {
              const fallbackNote = describeFallback(item.fallback_applied);
              return (
                <div key={item.id} className="border-b pb-4 last:border-0 last:pb-0">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">
                        {item.product?.name ?? t("unknownProduct")}
                        {item.is_cancelled && (
                          <Badge variant="destructive" className="ml-2">
                            {t("itemCancelledBadge")}
                          </Badge>
                        )}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {item.mode === "kg"
                          ? tCart("quantityKg", { quantity: Number(item.quantity) })
                          : t("quantityPieces", { count: Number(item.quantity) })}
                        {" · "}
                        {t("sizeRange", {
                          min: Number(item.size_min_kg),
                          max: Number(item.size_max_kg),
                        })}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge variant="outline">{BUYER_FALLBACK_LABELS[item.fallback]}</Badge>
                        {fallbackNote && (
                          <Badge className="bg-amber-100 text-amber-800">
                            {t("fallbackUsed", { note: fallbackNote })}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {isClosed && item.final_weight_kg !== null && item.price_per_kg !== null && (
                      <div className="text-right">
                        <ScaleChip
                          estimate={null}
                          final={{
                            total: Number(item.line_total),
                            weightKg: Number(item.final_weight_kg),
                            pricePerKg: Number(item.price_per_kg),
                          }}
                        />
                        {item.final_pieces !== null && (
                          <p className="text-xs text-muted-foreground">
                            {t("quantityPieces", { count: Number(item.final_pieces) })}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {isClosed && (
            <div className="mt-4 border-t pt-4">
              <p className="text-sm" style={{ color: "var(--buyer-confirmed)" }}>
                {t("weighedConfirmed")}
              </p>
              <div className="flex justify-between text-lg font-bold">
                <span>{t("total")}</span>
                <span className="font-buyer-mono">{formatPrice(Number(order.total_amount))}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {order.delivery_address && (
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <MapPin className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">{t("addressCardTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">{order.delivery_address}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {format.dateTime(new Date(`${order.delivery_date}T00:00:00`), {
                  weekday: "long",
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </p>
            </CardContent>
          </Card>
        )}

        {order.notes && order.status !== "cancelled" && (
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">{t("notesCardTitle")}</CardTitle>
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
