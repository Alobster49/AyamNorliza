import { getTranslations } from "next-intl/server";
import { getDriverInvoice } from "@/features/orders/server/driver-actions";
import { formatPrice, formatWeight } from "@/features/orders/lib/order-model";
import { PrintButton } from "./print-button";

export default async function DriverInvoicePage({
  params,
}: {
  params: Promise<{ organizationSlug: string; orderId: string }>;
}) {
  const { organizationSlug, orderId } = await params;
  const [result, t, tRoot] = await Promise.all([
    getDriverInvoice(organizationSlug, orderId),
    getTranslations("drive.invoice"),
    getTranslations(),
  ]);

  if (!result.ok) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-lg font-semibold">{t("cantOpenTitle")}</h1>
        {/* messageKey is a dynamic full path; typed t() only accepts literals. */}
        <p className="text-sm text-muted-foreground">{tRoot(result.messageKey as never)}</p>
      </main>
    );
  }

  const { organizationName, order, deliveredAttempt } = result.data;

  if (order.status !== "delivered" && order.status !== "closed") {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-lg font-semibold">{t("notDeliveredTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("notDeliveredDescription")}</p>
      </main>
    );
  }

  const items = order.items.filter((item) => !item.is_cancelled);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{organizationName}</h1>
          <p className="text-sm text-muted-foreground">
            {t("invoiceNumber", { number: order.id.slice(0, 8).toUpperCase() })} · {order.delivery_date}
          </p>
        </div>
        <div className="print:hidden">
          <PrintButton />
        </div>
      </div>

      <div className="rounded-xl border p-3 text-sm print:rounded-none print:border-0 print:p-0">
        <p className="font-medium">{order.customer?.name ?? "-"}</p>
        <p className="text-muted-foreground">{order.delivery_address}</p>
        {order.customer?.phone && <p className="text-muted-foreground">{order.customer.phone}</p>}
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">{t("headers.item")}</th>
            <th className="p-2 text-right">{t("headers.weight")}</th>
            <th className="p-2 text-right">{t("headers.pricePerKg")}</th>
            <th className="p-2 text-right">{t("headers.lineTotal")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b">
              <td className="p-2">
                {item.product?.name ?? t("itemFallback")}
                {item.final_pieces !== null ? ` · ${t("pieces", { count: item.final_pieces })}` : ""}
              </td>
              <td className="p-2 text-right tabular-nums">
                {item.final_weight_kg !== null ? formatWeight(item.final_weight_kg) : "-"}
              </td>
              <td className="p-2 text-right tabular-nums">
                {item.price_per_kg !== null ? formatPrice(item.price_per_kg) : "-"}
              </td>
              <td className="p-2 text-right tabular-nums">
                {item.line_total !== null ? formatPrice(item.line_total) : "-"}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="p-2 font-semibold" colSpan={3}>
              {t("grandTotal")}
            </td>
            <td className="p-2 text-right text-base font-bold tabular-nums">
              {formatPrice(order.total_amount ?? 0)}
            </td>
          </tr>
        </tfoot>
      </table>

      <div className="text-xs text-muted-foreground">
        {deliveredAttempt && (
          <p>
            {t("deliveredAt", { time: new Date(deliveredAttempt.attempted_at).toLocaleString() })}
            {deliveredAttempt.received_by ? ` · ${t("receivedBy", { name: deliveredAttempt.received_by })}` : ""}
          </p>
        )}
        <p>{t("footerNote")}</p>
      </div>
    </div>
  );
}
