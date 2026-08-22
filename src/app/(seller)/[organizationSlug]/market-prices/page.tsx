import { notFound } from "next/navigation";
import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import {
  getMarketState,
  getMarketSuggestions,
  getMarketTrend,
} from "@/features/market/server/actions";
import { MarketPricesClient } from "./market-prices-client";

export default async function MarketPricesPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();

  const state = await getMarketState(org.id);
  const [trend, suggestions] = await Promise.all([
    getMarketTrend([state]),
    getMarketSuggestions(org.id),
  ]);

  return (
    <MarketPricesClient
      organizationId={org.id}
      organizationSlug={organizationSlug}
      state={state}
      trend={trend}
      suggestions={suggestions}
    />
  );
}
