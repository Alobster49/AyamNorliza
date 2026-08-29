import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { requireMember, OrderPermissionError } from "@/features/hr/server/guards";
import { getMyLeaveData } from "@/features/hr/server/leave-actions";
import { todayInTimeZone } from "@/lib/time/org-date";
import { LeaveClient } from "@/features/hr/components/leave-client";

export default async function LeavePage({
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
    ctx = await requireMember(organizationSlug);
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      redirect({ href: `/${organizationSlug}`, locale: await getLocale() });
    }
    throw error;
  }

  const today = todayInTimeZone(ctx.timeZone);
  const defaultYear = Number(today.slice(0, 4));
  const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : defaultYear;

  const result = await getMyLeaveData(organizationSlug, year);

  return (
    <LeaveClient
      organizationSlug={organizationSlug}
      orgId={ctx.orgId}
      userId={ctx.userId}
      year={year}
      today={today}
      initialData={
        result.ok
          ? result.data
          : {
              types: [],
              ledger: [],
              requests: [],
              creditRequests: [],
              holidays: [],
              whosAway: [],
              viewer: { userId: ctx.userId, role: ctx.role, displayName: "" },
            }
      }
    />
  );
}
