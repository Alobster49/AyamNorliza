import { getLocale, getTranslations } from "next-intl/server";
import { CalendarDays, Truck } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/features/orders/lib/order-model";
import { DriverSignOutButton } from "@/features/orders/components/driver-sign-out";
import type { DriverClosedRunPayload } from "@/features/orders/server/driver-actions";

function Row({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-3 px-4 py-3.5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`shrink-0 text-sm font-medium tabular-nums ${danger ? "text-destructive" : ""}`}>{value}</p>
    </div>
  );
}

/**
 * What a driver sees after "Close run": closure, the day's totals, and that
 * nothing is planned for them yet. Reached only when the driver has no open
 * run -- a planned run for tomorrow would render the deck instead -- so the
 * "tomorrow" card can say "nothing assigned" without checking.
 */
export async function DriverDayClosed({
  organizationSlug,
  closed,
}: {
  organizationSlug: string;
  closed: DriverClosedRunPayload;
}) {
  const [t, tRoot, locale] = await Promise.all([getTranslations("drive.dayClosed"), getTranslations(), getLocale()]);
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: closed.timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(closed.closedAt));

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-1 flex-col gap-6 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
      <div className="flex justify-end">
        <DriverSignOutButton className="h-11 min-w-11" />
      </div>

      <header className="flex flex-col gap-2.5 pt-10">
        <span className="h-[3px] w-10 rounded-full" style={{ background: "var(--editorial-accent)" }} aria-hidden />
        <h1
          className="font-display text-4xl leading-[1.1] tracking-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("title")}
          <br />
          {closed.driverName ? t("greeting", { name: closed.driverName }) : t("greetingAnonymous")}
        </h1>
        <p className="text-[15px] leading-snug text-muted-foreground">{t("closedAt", { time })}</p>
      </header>

      <section className="divide-y overflow-hidden rounded-2xl border bg-card">
        <Row
          label={t("todayLabel", { truck: closed.truckLabel ?? tRoot("orders.driverDeck.truckFallback") })}
          value={t("delivered", { count: closed.delivered })}
        />
        <Row label={t("earnedLabel")} value={formatPrice(closed.earned)} />
        <Row
          label={t("notDeliveredLabel")}
          value={t("notDeliveredCount", { count: closed.notDelivered })}
          danger={closed.notDelivered > 0}
        />
      </section>

      <section className="flex flex-col gap-1.5">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("tomorrowLabel")}</h2>
        <div className="flex items-center gap-3.5 rounded-2xl border border-dashed p-4">
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-card text-muted-foreground"
            aria-hidden
          >
            <Truck className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">{t("tomorrowTitle")}</p>
            <p className="text-xs leading-4 text-muted-foreground">{t("tomorrowHint")}</p>
          </div>
        </div>
      </section>

      <div className="mt-auto flex flex-col gap-2.5">
        <Button variant="outline" size="lg" className="h-12 w-full gap-2 text-[15px]" asChild>
          <Link href={`/${organizationSlug}/leave`}>
            <CalendarDays className="size-4" aria-hidden />
            {tRoot("hr.nav.myLeave")}
          </Link>
        </Button>
        <DriverSignOutButton variant="default" className="h-12 w-full text-base" />
      </div>
    </main>
  );
}
