"use client";

import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { IssueSeverity, SetupEntity, SetupIssue } from "../../lib/setup-model";

const SEVERITY_STYLE: Record<
  IssueSeverity,
  { icon: typeof Info; className: string }
> = {
  blocker: { icon: OctagonAlert, className: "text-destructive" },
  warning: { icon: AlertTriangle, className: "text-amber-600 dark:text-amber-500" },
  info: { icon: Info, className: "text-muted-foreground" },
};

export function ReadinessPanel({
  issues,
  onFix,
}: {
  issues: SetupIssue[];
  onFix: (target: { entity: SetupEntity; recordId: string | null }) => void;
}) {
  const t = useTranslations("logistics.setup.readiness");

  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-4">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
        <div>
          <p className="font-medium">{t("readyTitle")}</p>
          <p className="text-sm text-muted-foreground">{t("readyBody")}</p>
        </div>
      </div>
    );
  }

  const blockers = issues.filter((i) => i.severity === "blocker").length;

  return (
    <section aria-label={t("ariaLabel")} className="rounded-lg border">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3">
        <h2 className="font-semibold">{t("issuesToFix", { count: issues.length })}</h2>
        {blockers > 0 ? (
          <span className="text-sm text-destructive">
            {t("blocksCustomerOrders", { count: blockers })}
          </span>
        ) : null}
      </header>
      <ul className="divide-y">
        {issues.map((issue) => {
          const style = SEVERITY_STYLE[issue.severity];
          const Icon = style.icon;
          return (
            <li
              key={issue.id}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
            >
              <Icon className={cn("h-4 w-4 shrink-0", style.className)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{issue.title}</p>
                <p className="text-sm text-muted-foreground">{issue.detail}</p>
              </div>
              <Button
                variant={issue.severity === "blocker" ? "default" : "outline"}
                size="sm"
                className="min-h-11 w-full lg:min-h-9 sm:w-auto"
                onClick={() => onFix(issue.target)}
              >
                {t("fix")}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
