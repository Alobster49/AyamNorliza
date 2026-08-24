"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminSummary } from "../admin-summary-model";

export function AdminPanel({
  summary,
  organizationSlug,
}: {
  summary: AdminSummary;
  organizationSlug: string;
}) {
  const t = useTranslations("analytics.admin");
  const stats = [
    { key: "activeMembers", value: summary.identity.activeMembers },
    { key: "pendingInvitations", value: summary.identity.pendingInvitations },
    { key: "openAccessReviews", value: summary.identity.openAccessReviews },
    { key: "activeSupportSessions", value: summary.identity.activeSupportSessions },
  ] as const;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          {stats.map(({ key, value }) => (
            <div key={key} className="rounded-md border p-2">
              <p className="text-xs text-muted-foreground">{t(key)}</p>
              <p className="text-lg font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
        <p className="text-xs font-medium text-muted-foreground">{t("priorities")}</p>
        {summary.priorityItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("allClear")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {summary.priorityItems.slice(0, 5).map((item) => (
              <li key={item.id} className="text-sm">
                {item.href ? (
                  <Link className="underline-offset-2 hover:underline" href={`/${organizationSlug}${item.href}`}>
                    {item.title}
                  </Link>
                ) : (
                  item.title
                )}{" "}
                <span className="text-muted-foreground">— {item.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
