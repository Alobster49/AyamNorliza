import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { OrderPermissionError } from "@/features/orders/server/guards";
import { requirePermission } from "@/lib/auth/require-permission";
import { getMarketState, getMarketTrend } from "@/features/market/server/actions";
import { MARKET_STATES } from "@/features/market/types";
import { MarketPricesClient } from "./market-prices-client";

/** 30 days on screen plus a few for the 30D delta to have a base point. */
const TREND_DAYS = 35;

export default async function MarketPricesPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;

  try {
    await requirePermission(organizationSlug, "market_prices", "view");
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      redirect({ href: `/${organizationSlug}/tasks`, locale: await getLocale() });
    }
    throw error;
  }

  const [focusState, trend] = await Promise.all([
    getMarketState(organizationSlug),
    getMarketTrend(organizationSlug, [...MARKET_STATES], TREND_DAYS),
  ]);

  return (
    <MarketPricesClient organizationSlug={organizationSlug} focusState={focusState} trend={trend} />
  );
}
