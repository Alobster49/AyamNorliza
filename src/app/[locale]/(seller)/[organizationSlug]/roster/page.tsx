import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { OrderPermissionError } from "@/features/orders/server/guards";
import { getDriverRoster } from "@/features/logistics/server/roster-actions";
import { mondayOf } from "@/features/logistics/lib/roster-model";
import { requirePermission } from "@/lib/auth/require-permission";
import { todayInTimeZone } from "@/lib/time/org-date";
import { RosterClient } from "./roster-client";

const WINDOWS = new Set([7, 14, 28]);

export default async function RosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ from?: string; days?: string }>;
}) {
  const { organizationSlug } = await params;
  const { from: fromParam, days: daysParam } = await searchParams;

  let timeZone: string;
  try {
    ({ timeZone } = await requirePermission(organizationSlug, "driver_roster", "view"));
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      redirect({ href: `/${organizationSlug}/tasks`, locale: await getLocale() });
    }
    throw error;
  }

  const today = todayInTimeZone(timeZone);
  const days = daysParam && WINDOWS.has(Number(daysParam)) ? Number(daysParam) : 14;
  const fromDate = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : mondayOf(today);

  const result = await getDriverRoster(organizationSlug, fromDate, days);
  if (!result.ok) {
    redirect({ href: `/${organizationSlug}/tasks`, locale: await getLocale() });
    // Unreachable -- redirect throws. It is declared `=> never`, but
    // TypeScript only narrows on that for plain function declarations, and
    // this one is destructured off createNavigation(), so without an explicit
    // return the compiler still treats `result` as possibly not ok below.
    return null;
  }

  return <RosterClient organizationSlug={organizationSlug} initial={result.data} />;
}
