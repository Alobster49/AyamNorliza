import { getTranslations } from "next-intl/server";
import { trackerIndex } from "@/features/buyer/lib/order-tracker";
import type { OrderStatus } from "@/features/orders/types";

const STEP_KEYS = ["booked", "shipped", "priceConfirmed"] as const;

export async function OrderTracker({ status }: { status: OrderStatus }) {
  const current = trackerIndex(status);
  if (current === null) return null;
  const t = await getTranslations("buyer.orderTracker");
  return (
    <ol className="flex items-center gap-2" aria-label={t("ariaLabel")}>
      {STEP_KEYS.map((key, i) => {
        const done = i <= current;
        return (
          <li key={key} className="flex flex-1 flex-col gap-1.5">
            <span
              className="h-1 rounded-full"
              style={{ backgroundColor: done ? "var(--buyer-confirmed)" : "var(--border)" }}
            />
            <span className={`text-xs ${done ? "font-medium" : "text-muted-foreground"}`}>{t(key)}</span>
          </li>
        );
      })}
    </ol>
  );
}
