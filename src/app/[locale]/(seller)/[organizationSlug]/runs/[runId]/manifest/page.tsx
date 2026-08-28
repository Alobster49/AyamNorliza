import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getRunManifest } from "@/features/orders/server/order-actions";
import { formatWeight } from "@/features/orders/lib/order-model";
import { sortedRunOrders } from "@/features/orders/lib/run-board-model";
import { PrintButton } from "./print-button";

export default async function ManifestPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; runId: string }>;
}) {
  const { organizationSlug, runId } = await params;
  const [result, t, tStatus, tUnits] = await Promise.all([
    getRunManifest(organizationSlug, runId),
    getTranslations("logistics.manifest"),
    getTranslations("status.order"),
    getTranslations("orders.units"),
  ]);
  if (!result.ok) notFound();
  const run = result.data;
  // Print in route order, so the paper matches the runs screen.
  const stops = sortedRunOrders(run);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-xl font-bold">
            {t("title", { truck: run.truck?.name ?? t("truckFallback") })}{" "}
            {run.truck?.code ? `(${run.truck.code})` : ""}
          </h1>
          <p className="text-muted-foreground">{run.run_date}</p>
        </div>
        <PrintButton />
      </div>

      <div className="-mx-4 overflow-x-auto px-4 print:mx-0 print:overflow-visible print:px-0">
        <table className="w-full min-w-[640px] border-collapse text-sm print:min-w-0">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">{t("headers.index")}</th>
              <th className="p-2">{t("headers.order")}</th>
              <th className="p-2">{t("headers.customer")}</th>
              <th className="p-2">{t("headers.zone")}</th>
              <th className="p-2">{t("headers.address")}</th>
              <th className="p-2">{t("headers.items")}</th>
              <th className="p-2">{t("headers.status")}</th>
            </tr>
          </thead>
          <tbody>
            {stops.map((order, index) => (
              <tr key={order.id} className="border-b align-top">
                <td className="p-2 font-mono">{index + 1}</td>
                <td className="p-2 font-mono">{order.id.slice(0, 8)}</td>
                <td className="p-2">{order.customer?.name ?? "-"}</td>
                <td className="p-2">{order.zone?.name ?? "-"}</td>
                <td className="p-2">{order.delivery_address}</td>
                <td className="p-2">
                  <ul>
                    {order.items
                      .filter((item) => !item.is_cancelled)
                      .map((item) => (
                        <li key={item.id}>
                          {item.product?.name ?? t("itemFallback")} —{" "}
                          {item.mode === "kg"
                            ? formatWeight(item.quantity)
                            : tUnits("pieces", { count: item.quantity })}
                        </li>
                      ))}
                  </ul>
                </td>
                <td className="p-2">{tStatus(order.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
