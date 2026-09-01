"use client";

import { useState } from "react";
import { AlertTriangle, CalendarDays, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { DriverCell, DriverRow, RosterGap, RosterView } from "../../lib/roster-model";
import { RosterGrid } from "./roster-grid";

function longDay(date: string, locale: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function GapCard({ gap, kind, canEdit, locale, onAssign }: { gap: RosterGap; kind: "gap" | "risk"; canEdit: boolean; locale: string; onAssign: (truckId: string, date: string) => void }) {
  const t = useTranslations("roster");
  const reason = gap.reason.kind === "leave" ? `${gap.reason.driverName} · ${gap.reason.leaveType}` : t("rail.reasonNoRegular");
  return (
    <div className={cn("flex flex-col gap-2 rounded-2xl border p-3", kind === "gap" ? "border-destructive/40 bg-destructive/5" : "roster-hatch-pending")}>
      <div className="flex items-center justify-between">
        <b className="text-[15px]">{gap.truckCode}</b>
        <span className={cn("rounded-2xl px-2 py-0.5 text-xs font-medium", kind === "gap" ? "bg-destructive/10 text-destructive" : "bg-background")} style={kind === "risk" ? { color: "var(--status-confirmed-text)" } : undefined}>
          {kind === "gap" ? t("mobile.badgeGap") : t("mobile.badgeRisk")}
        </span>
      </div>
      <span className="text-sm font-medium">{longDay(gap.date, locale)}</span>
      <span className="text-xs text-muted-foreground">{reason}</span>
      {canEdit ? (
        <Button className="h-11 w-full" variant={kind === "gap" ? "default" : "outline"} onClick={() => onAssign(gap.truckId, gap.date)}>
          {kind === "gap" ? <><Plus className="size-4" />{t("mobile.assignCover")}</> : t("mobile.assignCover")}
        </Button>
      ) : null}
    </div>
  );
}

function Sparkline({ row }: { row: DriverRow }) {
  return (
    <div className="grid h-2.5 gap-0.5" style={{ gridTemplateColumns: `repeat(${row.cells.length}, minmax(0, 1fr))` }}>
      {row.cells.map((c) => {
        const bg =
          c.state === "leave" ? "var(--status-cancelled)"
          : c.state === "pending" ? "var(--status-confirmed)"
          : c.state === "cover" ? "var(--status-pending)"
          : c.state === "driving" ? "var(--border)"
          : c.state === "free" ? "var(--muted)"
          : "transparent";
        return (
          <span
            key={c.date}
            className={cn("rounded-[2px]", (c.state === "off" || c.state === "holiday") && "roster-hatch-off")}
            style={c.state === "off" || c.state === "holiday" ? undefined : { background: bg }}
          />
        );
      })}
    </div>
  );
}

export function RosterMobile({ view, days, canEdit, locale, onAssign }: { view: RosterView; days: number; canEdit: boolean; locale: string; onAssign: (truckId: string, date: string, driverId?: string) => void }) {
  const t = useTranslations("roster");
  const [tab, setTab] = useState("gaps");
  const truckOf = (id: string | null) => view.truckRows.find((r) => r.truck.id === id)?.truck.code ?? "";

  function chipLabel(cell: DriverCell): string | null {
    switch (cell.state) {
      case "cover":
      case "driving":
        return cell.truckCode;
      case "leave":
        return t("grid.leave");
      case "pending":
        return t("grid.pending");
      case "free":
        return t("grid.free");
      case "holiday":
        return t("grid.holiday");
      case "off":
        return null;
      default: {
        const _exhaustive: never = cell.state;
        return _exhaustive;
      }
    }
  }

  return (
    <Tabs value={tab} onValueChange={setTab} className="md:hidden">
      <TabsList className="group-data-horizontal/tabs:h-[50px] w-full">
        <TabsTrigger value="gaps" className="h-11 flex-1">{t("mobile.gaps")}</TabsTrigger>
        <TabsTrigger value="trucks" className="h-11 flex-1">{t("mobile.trucks")}</TabsTrigger>
        <TabsTrigger value="drivers" className="h-11 flex-1">{t("mobile.drivers")}</TabsTrigger>
      </TabsList>

      <TabsContent value="gaps" className="flex flex-col gap-3 pt-3">
        <div className="flex items-start justify-between gap-3">
          <div className="leading-tight">
            <span className="font-display text-4xl text-destructive">{view.gaps.length}</span>
            <p className="text-xs text-muted-foreground">{t("mobile.needsDriver", { days })}</p>
          </div>
          <span className="inline-flex h-8 items-center gap-2 rounded-2xl border px-3 text-sm"><CalendarDays className="size-4" />{t("mobile.range", { days })}</span>
        </div>
        {view.gaps.length === 0 ? <p className="text-sm text-muted-foreground">{t("mobile.noGaps")}</p> : null}
        {view.gaps.map((g) => <GapCard key={`${g.truckId}|${g.date}`} gap={g} kind="gap" canEdit={canEdit} locale={locale} onAssign={onAssign} />)}
        {view.risks.length > 0 ? (
          <>
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("rail.risks")}</span>
            {view.risks.map((g) => <GapCard key={`${g.truckId}|${g.date}`} gap={g} kind="risk" canEdit={canEdit} locale={locale} onAssign={onAssign} />)}
          </>
        ) : null}
      </TabsContent>

      <TabsContent value="trucks" className="pt-3">
        <RosterGrid view={view} canEdit={canEdit} locale={locale} compact onCellClick={(truckId, date) => onAssign(truckId, date)} />
      </TabsContent>

      <TabsContent value="drivers" className="flex flex-col gap-3 pt-3">
        {view.driverRows.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><AlertTriangle className="size-4" />{t("grid.noDrivers")}</div>
        ) : null}
        {view.driverRows.map((row) => {
          const today = row.cells.find((c) => view.days.find((d) => d.date === c.date)?.isToday);
          const label = today ? chipLabel(today) : null;
          return (
            <div key={row.driver.userId} className="flex flex-col gap-2 rounded-2xl border p-3">
              <div className="flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-full bg-muted text-xs font-semibold">{row.driver.name.slice(0, 2).toUpperCase()}</span>
                <div className="min-w-0 flex-1 leading-tight">
                  <b className="block truncate text-sm">{row.driver.name}</b>
                  <span className="text-xs text-muted-foreground">{row.driver.regularTruckId ? t("mobile.usually", { truck: truckOf(row.driver.regularTruckId) }) : t("mobile.pool")}</span>
                </div>
                {label ? <span className="rounded-2xl bg-muted px-2 py-0.5 text-xs">{label}</span> : null}
              </div>
              <Sparkline row={row} />
            </div>
          );
        })}
      </TabsContent>
    </Tabs>
  );
}
