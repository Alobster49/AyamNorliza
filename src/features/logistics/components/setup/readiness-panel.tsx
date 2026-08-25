"use client";

import { useState } from "react";
import { AlertTriangle, Bell, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  const [open, setOpen] = useState(false);

  const blockers = issues.filter((i) => i.severity === "blocker").length;
  const hasIssues = issues.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="relative min-h-11 shrink-0 lg:min-h-10"
          aria-label={t("bellAriaLabel", { count: issues.length })}
        >
          <Bell className="h-5 w-5" />
          {hasIssues ? (
            <span
              aria-hidden
              className={cn(
                "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none text-white",
                blockers > 0
                  ? "bg-destructive"
                  : "bg-amber-500 dark:bg-amber-600",
              )}
            >
              {issues.length > 9 ? "9+" : issues.length}
            </span>
          ) : (
            <span
              aria-hidden
              className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-emerald-500"
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(24rem,calc(100vw-2rem))] p-0"
        aria-label={t("ariaLabel")}
      >
        {hasIssues ? (
          <>
            <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3">
              <h2 className="font-semibold">{t("issuesToFix", { count: issues.length })}</h2>
              {blockers > 0 ? (
                <span className="text-sm text-destructive">
                  {t("blocksCustomerOrders", { count: blockers })}
                </span>
              ) : null}
            </header>
            <ul className="max-h-80 divide-y overflow-y-auto">
              {issues.map((issue) => {
                const style = SEVERITY_STYLE[issue.severity];
                const Icon = style.icon;
                return (
                  <li
                    key={issue.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <Icon className={cn("h-4 w-4 shrink-0", style.className)} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{t(issue.titleKey, issue.titleValues)}</p>
                      <p className="text-sm text-muted-foreground">{t(issue.detailKey, issue.detailValues)}</p>
                    </div>
                    <Button
                      variant={issue.severity === "blocker" ? "default" : "outline"}
                      size="sm"
                      className="min-h-11 lg:min-h-9"
                      onClick={() => {
                        setOpen(false);
                        onFix(issue.target);
                      }}
                    >
                      {t("fix")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <div className="flex items-center gap-3 p-4">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
            <div>
              <p className="font-medium">{t("readyTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("readyBody")}</p>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
