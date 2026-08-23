import { TRACKER_STEPS, trackerIndex } from "@/features/buyer/lib/order-tracker";
import type { OrderStatus } from "@/features/orders/types";

export function OrderTracker({ status }: { status: OrderStatus }) {
  const current = trackerIndex(status);
  if (current === null) return null;
  return (
    <ol className="flex items-center gap-2" aria-label="Status pesanan">
      {TRACKER_STEPS.map((step, i) => {
        const done = i <= current;
        return (
          <li key={step} className="flex flex-1 flex-col gap-1.5">
            <span
              className="h-1 rounded-full"
              style={{ backgroundColor: done ? "var(--buyer-confirmed)" : "var(--border)" }}
            />
            <span className={`text-xs ${done ? "font-medium" : "text-muted-foreground"}`}>{step}</span>
          </li>
        );
      })}
    </ol>
  );
}
