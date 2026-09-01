"use client";

import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { RosterGap, RosterView } from "../../lib/roster-model";

/** How many gap / risk items render before "See all". */
const LIST_CAP = 20;

function longDay(date: string, locale: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
function shortRange(a: string, b: string, locale: string) {
  const f = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" });
  return a === b ? f(a) : `${f(a)}–${f(b)}`;
}

function GapItem({ gap, kind, view, canEdit, locale, onAssign }: { gap: RosterGap; kind: "gap" | "risk"; view: RosterView; canEdit: boolean; locale: string; onAssign: (truckId: string, date: string, driverId?: string) => void }) {
  const t = useTranslations("roster.rail");
  const nameOf = (id: string) => view.driverRows.find((r) => r.driver.userId === id)?.driver.name ?? id;
  const reason =
    gap.reason.kind === "leave"
      ? t("reasonLeave", { name: gap.reason.driverName, type: gap.reason.leaveType, range: shortRange(gap.reason.startDate, gap.reason.endDate, locale) })
      : t("reasonNoRegular");
  return (
    <div className={cn("flex flex-col gap-2 rounded-xl border p-3", kind === "gap" ? "border-destructive/40 bg-destructive/5" : "roster-hatch-pending")}>
      <div className="flex items-center justify-between gap-2">
        <b className="text-sm">{gap.truckCode}</b>
        <span className={cn("text-xs font-medium", kind === "gap" ? "text-destructive" : "")} style={kind === "risk" ? { color: "var(--status-confirmed-text)" } : undefined}>{longDay(gap.date, locale)}</span>
      </div>
      <span className="text-xs text-muted-foreground">{reason}</span>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{kind === "risk" ? t("planBackup") : t("free")}</span>
          {gap.freeDriverIds.length === 0 ? <span className="text-xs text-muted-foreground">{t("noneFree")}</span> : null}
          {gap.freeDriverIds.slice(0, 3).map((id, i) => (
            <Button key={id} size="sm" variant={i === 0 && kind === "gap" ? "default" : "outline"} className="h-7 px-2.5 text-xs" onClick={() => onAssign(gap.truckId, gap.date, id)}>
              {i === 0 && kind === "gap" ? <Plus className="size-3" /> : null}
              {nameOf(id)}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function RosterRail({ view, days, canEdit, locale, onAssign, docked = false }: { view: RosterView; days: number; canEdit: boolean; locale: string; onAssign: (truckId: string, date: string, driverId?: string) => void; docked?: boolean }) {
  const t = useTranslations("roster.rail");
  const risksByRange = view.risks; // one item per day keeps the list honest about how many days are exposed
  // A 30-truck org over 28 days can produce hundreds of items; render a page
  // of them and let the planner ask for the rest.
  const [showAll, setShowAll] = useState(false);
  const shownGaps = showAll ? view.gaps : view.gaps.slice(0, LIST_CAP);
  const shownRisks = showAll ? risksByRange : risksByRange.slice(0, LIST_CAP);
  const truncated = view.gaps.length > LIST_CAP || risksByRange.length > LIST_CAP;
  return (
    <Card className={cn(docked ? "" : "h-full")}>
      <CardContent className="flex flex-col gap-3">
        <div className="leading-none">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("next", { days })}</span>
          {view.gaps.length === 0 ? (
            <p className="mt-1 flex items-center gap-2">
              <Check className="size-5" style={{ color: "var(--status-ready-text)" }} />
              <span className="text-lg" style={{ color: "var(--status-ready-text)" }}>
                {t("headline", { count: 0 })}
              </span>
            </p>
          ) : (
            <p className="mt-1">
              <span className="font-display text-4xl text-destructive">{view.gaps.length}</span>{" "}
              <span className="text-lg">{t("headline", { count: view.gaps.length }).replace(/^\d+\s*/, "")}</span>
            </p>
          )}
        </div>
        <div className="h-px bg-border" />
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("gaps")}</span>
        <div className={cn("grid gap-2", docked ? "grid-cols-2" : "grid-cols-1")}>
          {shownGaps.map((g) => <GapItem key={`${g.truckId}|${g.date}`} gap={g} kind="gap" view={view} canEdit={canEdit} locale={locale} onAssign={onAssign} />)}
        </div>
        {risksByRange.length > 0 ? (
          <>
            <span className="mt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("risks")}</span>
            <div className={cn("grid gap-2", docked ? "grid-cols-2" : "grid-cols-1")}>
              {shownRisks.map((g) => <GapItem key={`${g.truckId}|${g.date}`} gap={g} kind="risk" view={view} canEdit={canEdit} locale={locale} onAssign={onAssign} />)}
            </div>
          </>
        ) : null}
        {truncated && !showAll ? (
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setShowAll(true)}>{t("seeAll")}</Button>
        ) : null}
        {!docked ? <p className="mt-auto border-t pt-2.5 text-xs text-muted-foreground">{t("footnote")}</p> : null}
      </CardContent>
    </Card>
  );
}
