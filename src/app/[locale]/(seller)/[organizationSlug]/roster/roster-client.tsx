"use client";

import { useCallback, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarDays, Users } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { HenEmptyState } from "@/components/shared/hen-empty-state";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { RosterGrid } from "@/features/logistics/components/roster/roster-grid";
import { AlertPill, RosterLegend } from "@/features/logistics/components/roster/roster-legend";
import { RosterRail } from "@/features/logistics/components/roster/roster-rail";
import { RosterMobile } from "@/features/logistics/components/roster/roster-mobile";
import { AssignCoverDialog } from "@/features/logistics/components/roster/assign-cover-dialog";
import { RegularDriversDialog } from "@/features/logistics/components/roster/regular-drivers-dialog";
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
  const [assignTarget, setAssignTarget] = useState<{ truckId: string; date: string; driverId?: string; asSheet: boolean } | null>(null);
  const [regularOpen, setRegularOpen] = useState(false);
  const isPhone = useIsMobile();
  const openAssign = useCallback((truckId: string, date: string, driverId?: string) => setAssignTarget({ truckId, date, driverId, asSheet: isPhone }), [isPhone]);

  const load = useCallback(
    (fromDate: string, days: number) => {
      startTransition(async () => {
        const result = await getDriverRoster(organizationSlug, fromDate, days);
        if (!result.ok) {
          toast({ title: t("toasts.couldNotLoad"), description: result.message, variant: "destructive" });
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
      <h2 className="text-lg font-semibold leading-tight">{t("title")}</h2>
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
        <span className="hidden md:inline-flex h-8 items-center gap-2 rounded-2xl border px-3 text-sm"><CalendarDays className="size-4" />{formatRange(data.fromDate, data.days, locale)}</span>
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
    // On lg the page fills the shell exactly -- 100dvh less the h-16 header
    // (4rem), the inset shell's m-2 (1rem) and the layout's p-4 (2rem) -- so
    // nothing here scrolls the page itself; the grid and the rail each scroll
    // inside their own box. Below lg the page flows normally.
    <div className={`flex flex-col gap-4 lg:h-[calc(100dvh-7rem)] lg:overflow-hidden ${pending ? "opacity-70" : ""}`}>
      {toolbar}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {data.canEdit ? (
          <Button variant="outline" size="sm" onClick={() => setRegularOpen(true)}><Users className="size-4" />{t("toolbar.setRegular")}</Button>
        ) : <span />}
        <div className="hidden md:block"><RosterLegend /></div>
      </div>
      <RosterMobile view={view} days={data.days} canEdit={data.canEdit} locale={locale} onAssign={openAssign} />

      {/* Desktop: grid + rail side by side, filling whatever height the toolbars
          leave -- each scrolls inside its own box. Tablet (md..lg): grid, then
          rail docked below in two columns, page scrolls as before. */}
      <div className="hidden md:flex md:flex-col md:gap-4 lg:min-h-0 lg:flex-1 lg:flex-row lg:items-stretch">
        <div className="min-w-0 flex-1 lg:h-full">
          <RosterGrid view={view} canEdit={data.canEdit} locale={locale} compact={data.days === 7} onCellClick={(truckId, date) => openAssign(truckId, date)} />
        </div>
        <aside className="lg:h-full lg:w-[300px] lg:shrink-0">
          <div className="hidden lg:block lg:h-full"><RosterRail view={view} days={data.days} canEdit={data.canEdit} locale={locale} onAssign={openAssign} /></div>
          <div className="lg:hidden"><RosterRail view={view} days={data.days} canEdit={data.canEdit} locale={locale} onAssign={openAssign} docked /></div>
        </aside>
      </div>

      <AssignCoverDialog
        open={assignTarget !== null}
        onOpenChange={(o) => { if (!o) setAssignTarget(null); }}
        organizationSlug={organizationSlug}
        view={view}
        truckId={assignTarget?.truckId ?? null}
        date={assignTarget?.date ?? null}
        preselectDriverId={assignTarget?.driverId ?? null}
        locale={locale}
        onDone={refresh}
        asSheet={assignTarget?.asSheet ?? isPhone}
      />
      <RegularDriversDialog open={regularOpen} onOpenChange={setRegularOpen} organizationSlug={organizationSlug} view={view} onDone={refresh} />
    </div>
  );
}
