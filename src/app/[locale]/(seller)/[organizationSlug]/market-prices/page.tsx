import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { OrderPermissionError, requireOrgRole } from "@/features/orders/server/guards";
import { MANAGER_ROLES } from "@/features/orders/lib/roles";
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

  await (async () => {
    try {
      return await requireOrgRole(organizationSlug, MANAGER_ROLES);
    } catch (error) {
      if (error instanceof OrderPermissionError) {
        redirect({ href: `/${organizationSlug}/tasks`, locale: await getLocale() });
      }
      throw error;
    }
  })();

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
