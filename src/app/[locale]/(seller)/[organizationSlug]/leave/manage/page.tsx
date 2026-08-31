import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { OrderPermissionError } from "@/features/orders/server/guards";
import { requirePermission } from "@/lib/auth/require-permission";
import { getManageData } from "@/features/hr/server/manage-actions";
import { todayInTimeZone } from "@/lib/time/org-date";
import { ManageClient } from "@/features/hr/components/manage-client";

export default async function LeaveManagePage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { organizationSlug } = await params;
  const { year: yearParam } = await searchParams;

  let ctx;
  try {
    ctx = await requirePermission(organizationSlug, "leave_management", "view");
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      redirect({ href: `/${organizationSlug}/leave`, locale: await getLocale() });
    }
    throw error;
  }

  const today = todayInTimeZone(ctx.timeZone);
  const defaultYear = Number(today.slice(0, 4));
  const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : defaultYear;

  const result = await getManageData(organizationSlug, year);

  return (
    <ManageClient
      organizationSlug={organizationSlug}
      year={year}
      initialData={
        result.ok
          ? result.data
          : { pending: [], pendingCredits: [], staff: [], types: [], holidays: [] }
      }
    />
  );
}
