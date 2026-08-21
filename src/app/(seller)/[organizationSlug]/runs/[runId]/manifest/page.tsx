import { notFound } from "next/navigation";
import { getRunManifest } from "@/features/orders/server/order-actions";
import { ORDER_STATUS_LABELS } from "@/features/orders/types";
import { formatWeight } from "@/features/orders/lib/order-model";
import { sortedRunOrders } from "@/features/orders/lib/run-board-model";
import { PrintButton } from "./print-button";

export default async function ManifestPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; runId: string }>;
}) {
  const { organizationSlug, runId } = await params;
  const result = await getRunManifest(organizationSlug, runId);
  if (!result.ok) notFound();
  const run = result.data;
  // Print in route order, so the paper matches the runs screen.
  const stops = sortedRunOrders(run);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-xl font-bold">
            Manifest — {run.truck?.name ?? "Truck"} {run.truck?.code ? `(${run.truck.code})` : ""}
          </h1>
          <p className="text-muted-foreground">{run.run_date}</p>
        </div>
        <PrintButton />
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">#</th>
            <th className="p-2">Order</th>
            <th className="p-2">Customer</th>
            <th className="p-2">Zone</th>
            <th className="p-2">Address</th>
            <th className="p-2">Items</th>
            <th className="p-2">Status</th>
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
                        {item.product?.name ?? "Item"} —{" "}
                        {item.mode === "kg" ? formatWeight(item.quantity) : `${item.quantity} pcs`}
                      </li>
                    ))}
                </ul>
              </td>
              <td className="p-2">{ORDER_STATUS_LABELS[order.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
