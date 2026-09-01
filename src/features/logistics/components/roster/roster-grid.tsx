"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { DriverCell, RosterDay, RosterView, TruckCell } from "../../lib/roster-model";

function dayLabel(date: string, locale: string, part: "weekday" | "day") {
  const d = new Date(`${date}T00:00:00Z`);
  return part === "weekday"
    ? d.toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" })
    : String(d.getUTCDate());
}

function DayHeader({ day, locale }: { day: RosterDay; locale: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center border-l px-1 py-1.5", day.weekday === 0 && "text-muted-foreground")}>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{dayLabel(day.date, locale, "weekday")}</span>
      <span className={cn("text-[15px] font-semibold tabular-nums leading-tight", day.isToday && "flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground")}>{dayLabel(day.date, locale, "day")}</span>
      {day.holiday ? <span className="max-w-full truncate text-[10px] font-medium" style={{ color: "var(--editorial-accent)" }}>{day.holiday}</span> : null}
    </div>
  );
}

const CELL = "flex min-h-11 min-w-0 flex-col justify-center gap-px border-l px-1.5 py-1 text-[11px] leading-tight [&>*]:max-w-full [&>*]:truncate";

function TruckCellView({ cell, today, canEdit, onClick, truckCode }: { cell: TruckCell; today: boolean; canEdit: boolean; onClick: () => void; truckCode: string }) {
  const t = useTranslations("roster.grid");
  const ring = today ? "shadow-[inset_0_0_0_2px_var(--primary)]" : "";
  switch (cell.state) {
    case "holiday":
      return <div className={cn(CELL, "bg-muted text-muted-foreground", ring)}><span className="text-[10px]">{t("holiday")}</span></div>;
    case "off":
      return <div className={cn(CELL, "roster-hatch-off", ring)} />;
    case "regular":
      return <div className={cn(CELL, "items-center text-foreground/30", ring)}><Check className="size-3.5" /></div>;
    case "gap":
      return (
        <button type="button" disabled={!canEdit} onClick={onClick} title={t("cellTitle", { truck: truckCode, date: cell.date, state: t("gap") })} className={cn(CELL, "w-full text-left font-semibold text-destructive outline-2 outline-dashed -outline-offset-[3px] outline-destructive", ring)}>
          <span>{t("gap")}</span>
        </button>
      );
    case "risk":
      return (
        <div className={cn(CELL, "roster-hatch-pending", ring)} style={{ color: "var(--status-confirmed-text)" }}>
          <b>{t("pending")}</b><span className="text-[10px]">{t("pendingSub")}</span>
        </div>
      );
    case "cover":
      return (
        <button type="button" disabled={!canEdit} onClick={onClick} title={t("cellTitle", { truck: truckCode, date: cell.date, state: t("cover") })} className={cn(CELL, "w-full text-left", ring)} style={{ background: "var(--status-pending-soft)", color: "var(--status-pending-text)" }}>
          <b>{cell.driverName}</b><span className="text-[10px]">{t("cover")}</span>
        </button>
      );
  }
}

function DriverCellView({ cell, today }: { cell: DriverCell; today: boolean }) {
  const t = useTranslations("roster.grid");
  const ring = today ? "shadow-[inset_0_0_0_2px_var(--primary)]" : "";
  switch (cell.state) {
    case "holiday":
      return <div className={cn(CELL, "bg-muted text-muted-foreground", ring)}><span className="text-[10px]">{t("holiday")}</span></div>;
    case "off":
      return <div className={cn(CELL, "roster-hatch-off", ring)} />;
    case "driving":
      return <div className={cn(CELL, "items-center text-foreground/30", ring)}><Check className="size-3.5" /></div>;
    case "free":
      return <div className={cn(CELL, "text-muted-foreground", ring)}><span>{t("free")}</span></div>;
    case "leave":
      return <div className={cn(CELL, ring)} style={{ background: "var(--status-cancelled-soft)", color: "var(--status-cancelled-text)" }}><b>{t("leave")}</b><span className="text-[10px]">{cell.leaveType}</span></div>;
    case "pending":
      return <div className={cn(CELL, "roster-hatch-pending", ring)} style={{ color: "var(--status-confirmed-text)" }}><b>{t("pending")}</b><span className="text-[10px]">{cell.leaveType}</span></div>;
    case "cover":
      return <div className={cn(CELL, ring)} style={{ background: "var(--status-pending-soft)", color: "var(--status-pending-text)" }}><b>{cell.truckCode}</b><span className="text-[10px]">{t("cover")}</span></div>;
  }
}

export function RosterGrid({
  view,
  canEdit,
  locale,
  onCellClick,
  compact = false,
}: {
  view: RosterView;
  canEdit: boolean;
  locale: string;
  onCellClick: (truckId: string, date: string) => void;
  compact?: boolean;
}) {
  const t = useTranslations("roster.grid");
  const head = compact ? 150 : 200;
  const cols = `${head}px repeat(${view.days.length}, minmax(0, 1fr))`;
  const rowHead = "flex min-w-0 items-center gap-2.5 border-r bg-muted/30 px-3 py-2";

  return (
    <div className="overflow-auto overscroll-contain rounded-xl border">
      <div style={{ minWidth: `${head + view.days.length * 44}px` }}>
        <div className="grid border-b bg-muted/50" style={{ gridTemplateColumns: cols }}>
          <div className={cn(rowHead, "bg-transparent")}><span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("truckHeader")}</span></div>
          {view.days.map((d) => <DayHeader key={d.date} day={d} locale={locale} />)}
        </div>

        {view.truckRows.map((row) => (
          <div
            key={row.truck.id}
            className="grid border-b"
            style={{ gridTemplateColumns: cols }}
            data-testid={`roster-truck-row-${row.truck.code}`}
          >
            <div className={rowHead}>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-sm font-semibold">{row.truck.code} <span className="font-normal text-muted-foreground">· {row.truck.name}</span></p>
                {row.regularDriver ? (
                  <p className="truncate text-xs text-muted-foreground">{row.regularDriver.name}</p>
                ) : (
                  <p className="truncate text-xs font-medium text-destructive">{t("noRegular")}</p>
                )}
              </div>
            </div>
            {row.cells.map((cell, i) => (
              <TruckCellView key={cell.date} cell={cell} today={view.days[i]!.isToday} canEdit={canEdit} onClick={() => onCellClick(row.truck.id, cell.date)} truckCode={row.truck.code} />
            ))}
          </div>
        ))}

        {view.poolRows.length > 0 ? (
          <>
            <div className="grid border-b bg-muted/50" style={{ gridTemplateColumns: cols }}>
              <div className={cn(rowHead, "min-h-7 bg-transparent py-1")}><span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("poolHeader")}</span></div>
              {view.days.map((d) => <div key={d.date} className="border-l" />)}
            </div>
            {view.poolRows.map((row) => (
              <div key={row.driver.userId} className="grid border-b last:border-b-0" style={{ gridTemplateColumns: cols }}>
                <div className={rowHead}>
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">{row.driver.name.slice(0, 2).toUpperCase()}</span>
                  <p className="truncate text-sm font-semibold">{row.driver.name}</p>
                </div>
                {row.cells.map((cell, i) => <DriverCellView key={cell.date} cell={cell} today={view.days[i]!.isToday} />)}
              </div>
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}
