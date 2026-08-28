import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getDriverInvoice } from "@/features/orders/server/driver-actions";
import { formatPrice, formatWeight } from "@/features/orders/lib/order-model";
import { formatDateTimeInTimeZone } from "@/lib/time/org-date";
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

  const {
    organizationName,
    organizationLegalName,
    organizationRegistrationNo,
    organizationAddress,
    organizationPhone,
    organizationEmail,
    organizationTimeZone,
    order,
    deliveredAttempt,
  } = result.data;

  if (order.status !== "delivered" && order.status !== "closed") {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-lg font-semibold">{t("notDeliveredTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("notDeliveredDescription")}</p>
      </main>
    );
  }

  const items = order.items.filter((item) => !item.is_cancelled);

  // The office's close-run sweep can mark an order delivered without door
  // weights (no driver ever ran it). Every cell would render "-" and the
  // grand total would read as a real (usually zero) amount, so show a
  // friendly state instead of a misleading invoice.
  const hasSettlement = items.length > 0 && items.some((item) => item.final_weight_kg !== null);
  if (!hasSettlement) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <h1 className="text-lg font-semibold">{t("pendingSettlementTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("pendingSettlementDescription")}</p>
      </main>
    );
  }

  const contactLine = [organizationPhone, organizationEmail].filter(Boolean).join(" · ");

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 p-4 print:max-w-none print:space-y-4 print:bg-white print:p-0 print:text-black">
      <div className="flex items-center justify-between print:hidden">
        <Link
          href={`/drive/${organizationSlug}`}
          className="-m-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg p-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("backToRun")}
        </Link>
        <PrintButton />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-border print:ring-black/20">
            <Image
              src="/logo-nb-poultry.webp"
              alt={organizationName}
              width={56}
              height={56}
              className="size-full object-contain"
            />
          </div>
          <div className="text-sm">
            <h1 className="text-lg font-bold leading-tight">{organizationName}</h1>
            {organizationLegalName && <p className="text-muted-foreground print:text-black/70">{organizationLegalName}</p>}
            {organizationRegistrationNo && (
              <p className="text-muted-foreground print:text-black/70">
                {t("regNo", { number: organizationRegistrationNo })}
              </p>
            )}
            {organizationAddress && (
              <p className="max-w-xs text-muted-foreground print:text-black/70">{organizationAddress}</p>
            )}
            {contactLine && <p className="text-muted-foreground print:text-black/70">{contactLine}</p>}
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold tracking-wide">{t("title")}</p>
          <p className="text-sm text-muted-foreground print:text-black/70">
            {t("invoiceNumber", { number: order.id.slice(0, 8).toUpperCase() })}
          </p>
          <p className="text-sm text-muted-foreground print:text-black/70">
            {t("dateLabel", { date: order.delivery_date })}
          </p>
        </div>
      </div>

      <div className="rounded-xl border p-3 text-sm print:rounded-none print:border-0 print:border-t print:border-black/20 print:p-0 print:pt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground print:text-black/60">
          {t("billTo")}
        </p>
        <p className="mt-1 font-medium">{order.customer?.name ?? "-"}</p>
        <p className="text-muted-foreground print:text-black/70">{order.delivery_address}</p>
        {order.customer?.phone && (
          <p className="text-muted-foreground print:text-black/70">{order.customer.phone}</p>
        )}
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-foreground/60 text-left print:border-black">
            <th className="p-2 font-semibold">{t("headers.no")}</th>
            <th className="p-2 font-semibold">{t("headers.item")}</th>
            <th className="p-2 text-right font-semibold">{t("headers.weight")}</th>
            <th className="p-2 text-right font-semibold">{t("headers.pricePerKg")}</th>
            <th className="p-2 text-right font-semibold">{t("headers.lineTotal")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={item.id} className="border-b print:border-black/20">
              <td className="p-2 text-muted-foreground print:text-black/70">{index + 1}</td>
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
          {deliveredAttempt?.cash_collected !== null && deliveredAttempt?.cash_collected !== undefined && (
            <tr className="border-b print:border-black/20">
              <td className="p-2 text-muted-foreground print:text-black/70" colSpan={4}>
                {t("cashCollected")}
              </td>
              <td className="p-2 text-right tabular-nums text-muted-foreground print:text-black/70">
                {formatPrice(deliveredAttempt.cash_collected)}
              </td>
            </tr>
          )}
          <tr>
            <td className="p-2 font-semibold" colSpan={4}>
              {t("grandTotal")}
            </td>
            <td className="p-2 text-right text-base font-bold tabular-nums">
              {formatPrice(order.total_amount ?? 0)}
            </td>
          </tr>
        </tfoot>
      </table>

      <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground print:border-black/20 print:text-black/60">
        {deliveredAttempt && (
          <p>
            {t("deliveredAt", {
              time: formatDateTimeInTimeZone(deliveredAttempt.attempted_at, organizationTimeZone),
            })}
            {deliveredAttempt.received_by ? ` · ${t("receivedBy", { name: deliveredAttempt.received_by })}` : ""}
          </p>
        )}
        <p>{t("footerNote")}</p>
        <p>{t("computerGenerated")}</p>
      </div>
    </div>
  );
}
