"use client";

import { useCallback, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarDays, Users } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { HenEmptyState } from "@/components/shared/hen-empty-state";
import { useToast } from "@/hooks/use-toast";
import { RosterGrid } from "@/features/logistics/components/roster/roster-grid";
import { AlertPill, RosterLegend } from "@/features/logistics/components/roster/roster-legend";
import { getDriverRoster, type RosterData } from "@/features/logistics/server/roster-actions";
import { mondayOf } from "@/features/logistics/lib/roster-model";
import { shiftIsoDate } from "@/lib/time/org-date";

const WINDOWS = [7, 14, 28] as const;

export function formatRange(from: string, days: number, locale: string): string {
  const fmt = (iso: string, withYear: boolean) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC", ...(withYear ? { year: "numeric" } : {}) });
  return `${fmt(from, false)} – ${fmt(shiftIsoDate(from, days - 1), true)}`;
}

export function RosterClient({ organizationSlug, initial }: { organizationSlug: string; initial: RosterData }) {
  const t = useTranslations("roster");
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const [data, setData] = useState<RosterData>(initial);
  const [pending, startTransition] = useTransition();
  const [assignTarget, setAssignTarget] = useState<{ truckId: string; date: string } | null>(null);
  const [regularOpen, setRegularOpen] = useState(false);

  const load = useCallback(
    (fromDate: string, days: number) => {
      startTransition(async () => {
        const result = await getDriverRoster(organizationSlug, fromDate, days);
        if (!result.ok) {
          toast({ title: t("toasts.couldNotSave"), description: result.message, variant: "destructive" });
          return;
        }
        setData(result.data);
        router.replace(`/${organizationSlug}/roster?from=${fromDate}&days=${days}`, { scroll: false });
      });
    },
    [organizationSlug, router, t, toast],
  );

  const refresh = useCallback(() => load(data.fromDate, data.days), [data.fromDate, data.days, load]);
  const { view } = data;
  const containsToday = view.days.some((d) => d.isToday);

  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-display text-2xl leading-tight">{t("title")}</h2>
      <div className="flex flex-wrap items-center gap-2">
        <AlertPill gaps={view.gaps.length} risks={view.risks.length} />
        <div className="inline-flex rounded-2xl bg-muted p-0.5">
          {WINDOWS.map((w) => (
            <button key={w} type="button" onClick={() => load(data.fromDate, w)} aria-pressed={data.days === w} className={`rounded-2xl px-3 py-1 text-sm font-medium ${data.days === w ? "bg-background shadow-sm" : "text-muted-foreground"}`}>
              {w === 7 ? t("window.week") : w === 14 ? t("window.twoWeeks") : t("window.fourWeeks")}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" aria-label={t("window.previous")} onClick={() => load(shiftIsoDate(data.fromDate, -data.days), data.days)}>‹</Button>
        <Button variant={containsToday ? "default" : "outline"} size="sm" onClick={() => load(mondayOf(data.today), data.days)}>{t("window.today")}</Button>
        <Button variant="outline" size="sm" aria-label={t("window.next")} onClick={() => load(shiftIsoDate(data.fromDate, data.days), data.days)}>›</Button>
        <span className="inline-flex h-8 items-center gap-2 rounded-2xl border px-3 text-sm"><CalendarDays className="size-4" />{formatRange(data.fromDate, data.days, locale)}</span>
      </div>
    </div>
  );

  if (view.truckRows.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {toolbar}
        <HenEmptyState title={t("grid.empty")} subtitle={t("grid.emptyHint")} />
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-4 ${pending ? "opacity-70" : ""}`}>
      {toolbar}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {data.canEdit ? (
          <Button variant="outline" size="sm" onClick={() => setRegularOpen(true)}><Users className="size-4" />{t("toolbar.setRegular")}</Button>
        ) : <span />}
        <RosterLegend />
      </div>
      <div className="hidden md:block">
        <RosterGrid view={view} canEdit={data.canEdit} locale={locale} compact={data.days === 7} onCellClick={(truckId, date) => setAssignTarget({ truckId, date })} />
      </div>
      {/* Task 6 mounts the rail here; Task 7 mounts the mobile tabs + dialogs. */}
      <span hidden data-assign-target={assignTarget ? `${assignTarget.truckId}|${assignTarget.date}` : ""} data-regular-open={regularOpen ? "1" : "0"} onClick={refresh} />
    </div>
  );
}
