"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import {
  assignRunDriver,
  getOrgDrivers,
  getRuns,
  reorderRun,
  setRunStatus,
} from "@/features/orders/server/order-actions";
import type { RunDriver, RunWithOrders, RunStatus } from "@/features/orders/types";
import {
  boardAlerts,
  completionImpact,
  departureCheck,
  departureImpact,
  moveStop,
  runStopRows,
  runVitals,
  truckLabel,
  type BoardAlert,
  type StopRow,
} from "@/features/orders/lib/run-board-model";
import { shiftIsoDate, todayInTimeZone } from "@/lib/time/org-date";
import { useTranslations } from "next-intl";
import { resolveMessageKey } from "@/lib/i18n/resolve-message-key";
import { HenEmptyState } from "@/components/shared/hen-empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const TONE_CLASS: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  hot: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  accent: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  muted: "bg-muted text-muted-foreground",
};

const RUN_TONE: Record<RunStatus, string> = {
  planned: "warn",
  departed: "accent",
  completed: "ok",
};

function money(amount: number): string {
  return `RM ${amount.toFixed(2)}`;
}

function nowMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium ${TONE_CLASS[tone] ?? TONE_CLASS.muted}`}
    >
      {children}
    </span>
  );
}

/** Load against truck capacity. Same dial the dispatch plan deck uses. */
function Dial({ pct, label }: { pct: number | null; label: string }) {
  const clamped = Math.min(Math.max(pct ?? 0, 0), 100);
  const tone = (pct ?? 0) > 100 ? "var(--destructive)" : (pct ?? 0) >= 90 ? "var(--color-warning)" : "var(--primary)";
  return (
    <div
      className="run-dial grid size-11 shrink-0 place-items-center rounded-full text-[10px] font-semibold tabular-nums"
      style={
        {
          "--dial-pct": `${clamped}%`,
          background: `conic-gradient(${tone} var(--dial-pct), var(--muted) var(--dial-pct) 100%)`,
        } as React.CSSProperties
      }
      role="img"
      aria-label={label}
    >
      <span className="grid size-8 place-items-center rounded-full bg-card">
        {pct === null ? "—" : `${Math.round(pct)}%`}
      </span>
    </div>
  );
}

function Bar({ pct, tone = "bg-primary" }: { pct: number; tone?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={`h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500 motion-safe:ease-[cubic-bezier(0.23,1,0.32,1)] ${tone}`}
        style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Needs a human
// ---------------------------------------------------------------------------

function AlertBlock({ alerts, onJump }: { alerts: BoardAlert[]; onJump: (runId: string) => void }) {
  const t = useTranslations("deliveryRuns.needsHuman");
  if (alerts.length === 0) return null;
  return (
    <section
      aria-label={t("ariaLabel")}
      className="animate-panel-in rounded-lg border border-destructive/50 bg-destructive/5 p-3"
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-destructive">
        {t("heading", { count: alerts.length })}
      </p>
      <ul className="flex flex-col gap-1.5">
        {alerts.map((alert, index) => (
          <li key={`${alert.runId}-${alert.kind}-${index}`}>
            <button
              type="button"
              onClick={() => onJump(alert.runId)}
              className="w-full rounded-md px-1 py-0.5 text-left text-sm transition-colors duration-150 hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destructive"
            >
              <span className="font-medium">{alert.truckLabel}</span>
              <span className="text-muted-foreground">
                {" "}
                — {resolveMessageKey(t, `messages.${alert.kind}`, alert.params)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Truck rail
// ---------------------------------------------------------------------------

function RailCard({
  run,
  selected,
  onSelect,
}: {
  run: RunWithOrders;
  selected: boolean;
  onSelect: () => void;
}) {
  const vitals = runVitals(run);
  const t = useTranslations("deliveryRuns.rail");
  const tStatus = useTranslations("status.run");
  const cardRef = useRef<HTMLButtonElement>(null);
  // The alert banner can select a card that sits off-screen in the phone rail.
  useEffect(() => {
    if (!selected) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    cardRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [selected]);
  return (
    <button
      ref={cardRef}
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={`flex w-56 shrink-0 snap-start flex-col gap-2 rounded-lg border p-3 text-left transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out motion-safe:active:scale-[0.985] lg:w-full ${
        selected ? "border-primary bg-accent/40 ring-1 ring-primary" : "bg-card hover:bg-accent/30"
      }`}
    >
      <div className="flex items-center gap-3">
        <Dial pct={vitals.loadPct} label={t("load", { name: truckLabel(run) })} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{run.truck?.name ?? t("truckFallback")}</div>
          <div className="truncate text-[11px] tabular-nums text-muted-foreground">
            {vitals.capacityKg !== null
              ? `${vitals.weightKg} / ${vitals.capacityKg} kg`
              : `${vitals.weightKg} kg`}
            {" · "}
            {t("stopCount", { count: vitals.total })}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {run.driver?.name ?? t("noDriver")}
          </div>
        </div>
      </div>
      <Bar pct={vitals.progressPct} tone={vitals.progressPct === 100 ? "bg-emerald-500" : "bg-primary"} />
      <div className="flex items-center justify-between gap-2">
        <Chip tone={RUN_TONE[run.status]}>{tStatus(run.status)}</Chip>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {vitals.delivered}/{vitals.total}
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Stops
// ---------------------------------------------------------------------------

function StopTable({
  rows,
  canReorder,
  onMove,
}: {
  rows: StopRow[];
  canReorder: boolean;
  onMove: (from: number, to: number) => void;
}) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const t = useTranslations("deliveryRuns.table");
  const tRoot = useTranslations();

  function dropOn(index: number) {
    if (dragFrom !== null && dragFrom !== index) onMove(dragFrom, index);
    setDragFrom(null);
    setDragOver(null);
  }

  return (
    <>
      {/* Desktop and tablet: one row per stop */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="w-10 px-3 py-2 font-medium">#</th>
              {canReorder && (
                <th className="w-8 px-1 py-2 font-medium">
                  <span className="sr-only">{t("reorder")}</span>
                </th>
              )}
              <th className="px-3 py-2 font-medium">{t("headers.stop")}</th>
              <th className="px-3 py-2 font-medium">{t("headers.zone")}</th>
              <th className="px-3 py-2 font-medium">{t("headers.load")}</th>
              <th className="hidden px-3 py-2 font-medium lg:table-cell">{t("headers.amount")}</th>
              <th className="hidden px-3 py-2 font-medium lg:table-cell">{t("headers.window")}</th>
              <th className="px-3 py-2 font-medium">{t("headers.state")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.orderId}
                draggable={canReorder}
                onDragStart={() => setDragFrom(index)}
                onDragEnd={() => {
                  setDragFrom(null);
                  setDragOver(null);
                }}
                onDragOver={(event) => {
                  if (!canReorder || dragFrom === null) return;
                  event.preventDefault();
                  setDragOver(index);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  dropOn(index);
                }}
                className={`border-b transition-[background-color,opacity] duration-150 last:border-0 ${canReorder ? "cursor-grab active:cursor-grabbing" : ""} ${
                  dragOver === index && dragFrom !== index ? "bg-accent/50" : ""
                } ${dragFrom === index ? "opacity-40" : ""}`}
              >
                <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">{row.sequence}</td>
                {canReorder && (
                  <td className="px-1 py-2">
                    <div className="flex flex-col">
                      <button
                        type="button"
                        aria-label={t("moveEarlier", { name: row.customerName })}
                        disabled={index === 0}
                        onClick={() => onMove(index, index - 1)}
                        className="flex h-5 w-7 items-center justify-center rounded text-[10px] leading-none text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        aria-label={t("moveLater", { name: row.customerName })}
                        disabled={index === rows.length - 1}
                        onClick={() => onMove(index, index + 1)}
                        className="flex h-5 w-7 items-center justify-center rounded text-[10px] leading-none text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        ▼
                      </button>
                    </div>
                  </td>
                )}
                <td className="px-3 py-2">
                  <div className="font-medium">{row.customerName}</div>
                  <div className="max-w-xs truncate text-xs text-muted-foreground">{row.address}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">{row.zoneName}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums">
                  {row.weightKg > 0 ? `${row.weightKg} kg · ` : ""}
                  {t("itemCount", { count: row.itemCount })}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-xs tabular-nums lg:table-cell">{money(row.amount)}</td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-xs tabular-nums lg:table-cell">
                  {row.window ? `${row.window.start}–${row.window.end}` : "—"}
                </td>
                <td className="px-3 py-2">
                  <Chip tone={row.state.tone}>{resolveMessageKey(tRoot, row.state.labelKey)}</Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: stacked cards, no horizontal scrolling */}
      <ul className="flex flex-col divide-y md:hidden">
        {rows.map((row, index) => (
          <li key={row.orderId} className="flex flex-col gap-1 px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium">
                <span className="mr-1.5 text-xs tabular-nums text-muted-foreground">{row.sequence}</span>
                {row.customerName}
              </span>
              <div className="flex items-center gap-1.5">
                {canReorder && (
                  <span className="flex gap-0.5">
                    <button
                      type="button"
                      aria-label={t("moveEarlier", { name: row.customerName })}
                      disabled={index === 0}
                      onClick={() => onMove(index, index - 1)}
                      className="rounded border px-1.5 py-1 text-[11px] leading-none text-muted-foreground transition-colors duration-150 active:bg-accent disabled:opacity-30"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      aria-label={t("moveLater", { name: row.customerName })}
                      disabled={index === rows.length - 1}
                      onClick={() => onMove(index, index + 1)}
                      className="rounded border px-1.5 py-1 text-[11px] leading-none text-muted-foreground transition-colors duration-150 active:bg-accent disabled:opacity-30"
                    >
                      ▼
                    </button>
                  </span>
                )}
                <Chip tone={row.state.tone}>{resolveMessageKey(tRoot, row.state.labelKey)}</Chip>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{row.address}</p>
            <p className="text-xs tabular-nums text-muted-foreground">
              {row.zoneName} · {row.weightKg > 0 ? `${row.weightKg} kg · ` : ""}
              {money(row.amount)}
              {row.window ? ` · ${row.window.start}–${row.window.end}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

// ---------------------------------------------------------------------------
// Run detail
// ---------------------------------------------------------------------------

type PendingAction = { status: "departed" | "completed" } | null;

function RunDetail({
  run,
  organizationSlug,
  onStatusChange,
  onReorder,
  onAssignDriver,
  drivers,
  busy,
}: {
  run: RunWithOrders;
  organizationSlug: string;
  onStatusChange: (status: "departed" | "completed") => void;
  onReorder: (orderIds: string[]) => Promise<boolean>;
  onAssignDriver: (driverId: string | null) => void;
  drivers: RunDriver[];
  busy: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("deliveryRuns.detail");
  const tRail = useTranslations("deliveryRuns.rail");
  const tStatus = useTranslations("status.run");
  const tCommon = useTranslations("common");
  const [pending, setPending] = useState<PendingAction>(null);
  // Local route order, applied the moment the dispatcher moves a stop. The
  // server confirms it a beat later; a refused move snaps back.
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const vitals = runVitals(run);
  const gate = departureCheck(run);
  const baseRows = runStopRows(run);
  const rows = localOrder
    ? localOrder
        .map((id) => baseRows.find((row) => row.orderId === id))
        .filter((row): row is StopRow => row !== undefined)
        .map((row, index) => ({ ...row, sequence: index + 1 }))
    : baseRows;
  const canReorder = run.status !== "completed";

  async function handleMove(from: number, to: number) {
    const ids = rows.map((row) => row.orderId);
    const next = moveStop(ids, from, to);
    setLocalOrder(next);
    const accepted = await onReorder(next);
    if (!accepted) setLocalOrder(null);
  }

  const blockers = [...gate.unloaded, ...gate.unweighed];

  return (
    <div className="animate-panel-in flex min-w-0 flex-col rounded-lg border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{truckLabel(run)}</h2>
          <p className="text-xs text-muted-foreground">
            {vitals.window ? `${vitals.window.start}–${vitals.window.end} · ` : ""}
            {tRail("stopCount", { count: vitals.total })}
            {vitals.capacityKg !== null
              ? t("windowCapacity", { weight: vitals.weightKg, capacity: vitals.capacityKg })
              : ""}
          </p>
          <label className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
            <span>{t("driverLabel")}</span>
            <select
              value={run.driver_id ?? ""}
              disabled={busy || run.status === "completed"}
              onChange={(event) => onAssignDriver(event.target.value || null)}
              className="rounded-md border bg-background px-2 py-1 text-xs disabled:opacity-50"
            >
              <option value="">{t("nobodyAssigned")}</option>
              {drivers.map((driver) => (
                <option key={driver.userId} value={driver.userId}>
                  {driver.name}
                </option>
              ))}
              {/* A driver who has since lost the role still names the run they drove. */}
              {run.driver && !drivers.some((d) => d.userId === run.driver?.userId) && (
                <option value={run.driver.userId}>{run.driver.name}</option>
              )}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={RUN_TONE[run.status]}>{tStatus(run.status)}</Chip>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/${organizationSlug}/runs/${run.id}/manifest`)}
          >
            {t("manifest")}
          </Button>
          {run.status === "planned" && (
            <Button size="sm" disabled={busy || !gate.canDepart} onClick={() => setPending({ status: "departed" })}>
              {t("markDeparted")}
            </Button>
          )}
          {run.status !== "completed" && (
            <Button
              size="sm"
              variant={run.status === "departed" ? "default" : "outline"}
              disabled={busy}
              onClick={() => setPending({ status: "completed" })}
            >
              {t("closeRun")}
            </Button>
          )}
        </div>
      </header>

      {/* Departure gate: say what is missing, by name */}
      {run.status === "planned" && blockers.length > 0 && (
        <div className="animate-panel-in border-b bg-amber-50 px-4 py-2.5 text-sm dark:bg-amber-950/40">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            {t("cannotDepart.title")}
          </p>
          <p className="text-xs text-amber-900/80 dark:text-amber-200/80">
            {gate.unloaded.length > 0 &&
              t("cannotDepart.notLoaded", { list: gate.unloaded.map((o) => o.label).join(", ") })}
            {gate.unweighed.length > 0 &&
              t("cannotDepart.unweighed", { list: gate.unweighed.map((o) => o.label).join(", ") })}
          </p>
        </div>
      )}

      {/* Confirm step, in the page, saying exactly what will happen */}
      {pending && (
        <div className="animate-panel-in flex flex-wrap items-center justify-between gap-3 border-b bg-muted/50 px-4 py-3">
          <div className="min-w-0 text-sm">
            {pending.status === "departed" ? (
              <>
                <p className="font-medium">{t("confirm.sendOutTitle", { truck: truckLabel(run) })}</p>
                <p className="text-xs text-muted-foreground">
                  {departureImpact(run).droppedFromRun.length > 0
                    ? t("confirm.droppedWarning", {
                        count: departureImpact(run).droppedFromRun.length,
                        list: departureImpact(run)
                          .droppedFromRun.map((o) => o.label)
                          .join(", "),
                      })
                    : t("confirm.allReady")}{" "}
                  {t("confirm.cannotReturn")}
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">{t("confirm.closeTitle", { truck: truckLabel(run) })}</p>
                <p className="text-xs text-muted-foreground">
                  {completionImpact(run).markedDelivered > 0
                    ? t("confirm.markedDelivered", { count: completionImpact(run).markedDelivered })
                    : t("confirm.allDelivered")}{" "}
                  {t("confirm.cannotUndo")}
                </p>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPending(null)}>
              {tCommon("cancel")}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => onStatusChange(pending.status)}>
              {pending.status === "departed" ? t("confirm.sendOutConfirm") : t("closeRun")}
            </Button>
          </div>
        </div>
      )}

      {/* Run vitals */}
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3 border-b bg-muted/30 px-4 py-3">
        <div className="min-w-[180px] flex-1">
          <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("vitals.progress", { delivered: vitals.delivered, remaining: vitals.remaining })}
            {vitals.failed > 0 ? t("vitals.failedSuffix", { count: vitals.failed }) : ""}
          </p>
          <Bar pct={vitals.progressPct} tone={vitals.progressPct === 100 ? "bg-emerald-500" : "bg-primary"} />
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("vitals.collected")}</p>
          <p className="text-base font-semibold tabular-nums">{money(vitals.cashCollected)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("vitals.outstanding")}</p>
          <p className="text-base font-semibold tabular-nums">{money(vitals.cashOutstanding)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("vitals.loaded")}</p>
          <p className="text-base font-semibold tabular-nums">
            {vitals.loaded}/{vitals.total}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">{t("noOrders")}</p>
      ) : (
        <StopTable rows={rows} canReorder={canReorder} onMove={handleMove} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type RunsClientProps = {
  organizationSlug: string;
  initialDate: string;
  /** The org's calendar, so "Today" here means the same day the page rendered. */
  timeZone: string;
  initialRuns: RunWithOrders[];
};

export function RunsClient({ organizationSlug, initialDate, timeZone, initialRuns }: RunsClientProps) {
  const { toast } = useToast();
  const t = useTranslations("deliveryRuns");
  const tPages = useTranslations("dashboard.pages");
  const tEmpty = useTranslations("deliveryRuns.empty");
  const [date, setDate] = useState(initialDate);
  const [runs, setRuns] = useState(initialRuns);
  const [selectedId, setSelectedId] = useState<string | null>(initialRuns[0]?.id ?? null);
  const [loading, setLoading] = useState(false);
  const [drivers, setDrivers] = useState<RunDriver[]>([]);
  const [busy, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getOrgDrivers(organizationSlug).then((result) => {
      if (!cancelled && result.ok) setDrivers(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [organizationSlug]);

  const selected = useMemo(
    () => runs.find((run) => run.id === selectedId) ?? runs[0] ?? null,
    [runs, selectedId],
  );
  // Re-evaluate time-based alerts (overdue windows) while the page sits open
  // on a depot screen, not only when the data reloads.
  const [minuteNow, setMinuteNow] = useState(() => nowMinutes());
  useEffect(() => {
    const timer = setInterval(() => setMinuteNow(nowMinutes()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const alerts = useMemo(() => boardAlerts(runs, { nowMinutes: minuteNow }), [runs, minuteNow]);

  async function loadRuns(nextDate: string) {
    setLoading(true);
    const result = await getRuns(organizationSlug, nextDate);
    setLoading(false);
    if (!result.ok) {
      toast({ title: t("toasts.couldNotLoadRuns"), description: result.message, variant: "destructive" });
      return;
    }
    setRuns(result.data);
    setSelectedId((current) =>
      result.data.some((run) => run.id === current) ? current : (result.data[0]?.id ?? null),
    );
  }

  async function handleDateChange(nextDate: string) {
    if (!nextDate) return;
    setDate(nextDate);
    await loadRuns(nextDate);
  }

  async function handleReorder(runId: string, orderIds: string[]): Promise<boolean> {
    const result = await reorderRun(organizationSlug, runId, orderIds);
    if (!result.ok) {
      toast({ title: t("toasts.couldNotReorderRun"), description: result.message, variant: "destructive" });
      await loadRuns(date);
      return false;
    }
    await loadRuns(date);
    return true;
  }

  function handleAssignDriver(runId: string, driverId: string | null) {
    startTransition(async () => {
      const result = await assignRunDriver(organizationSlug, runId, driverId);
      if (!result.ok) {
        toast({ title: t("toasts.couldNotSetDriver"), description: result.message, variant: "destructive" });
        return;
      }
      toast({ title: driverId ? t("toasts.driverAssigned") : t("toasts.driverRemoved") });
      await loadRuns(date);
    });
  }

  function handleStatusChange(runId: string, status: "departed" | "completed") {
    startTransition(async () => {
      const result = await setRunStatus(organizationSlug, runId, status);
      if (!result.ok) {
        toast({ title: t("toasts.couldNotUpdateRun"), description: result.message, variant: "destructive" });
        return;
      }
      toast({ title: status === "departed" ? t("toasts.truckSentOut") : t("toasts.runClosed") });
      await loadRuns(date);
    });
  }

  const isToday = date === todayInTimeZone(timeZone);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{tPages("deliveryRuns")}</h1>
          <p className="text-muted-foreground">{t("subheading")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-label={t("previousDay")}
            onClick={() => handleDateChange(shiftIsoDate(date, -1))}
          >
            ‹
          </Button>
          <Button
            variant={isToday ? "default" : "outline"}
            size="sm"
            onClick={() => handleDateChange(todayInTimeZone(timeZone))}
          >
            {t("today")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label={t("nextDay")}
            onClick={() => handleDateChange(shiftIsoDate(date, 1))}
          >
            ›
          </Button>
          <Input
            type="date"
            value={date}
            onChange={(event) => handleDateChange(event.target.value)}
            className="w-40"
          />
        </div>
      </div>

      <AlertBlock alerts={alerts} onJump={setSelectedId} />

      {runs.length === 0 ? (
        loading ? (
          <p role="status" className="text-muted-foreground">
            {t("loading")}
          </p>
        ) : (
          <HenEmptyState title={tEmpty("title")} subtitle={tEmpty("subtitle")} className="py-20" />
        )
      ) : (
        // Keep the stale board visible and dimmed while the next date loads,
        // so the layout never collapses to a one-line loading message.
        <div
          aria-busy={loading}
          className={`grid gap-4 transition-opacity duration-200 lg:grid-cols-[264px_minmax(0,1fr)] ${
            loading ? "pointer-events-none opacity-50" : ""
          }`}
        >
          <div
            className="-mx-1 flex snap-x snap-proximity gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0"
            role="tablist"
            aria-label={t("trucksRunningToday")}
          >
            {runs.map((run) => (
              <RailCard
                key={run.id}
                run={run}
                selected={selected?.id === run.id}
                onSelect={() => setSelectedId(run.id)}
              />
            ))}
          </div>

          {selected && (
            <RunDetail
              // Remount on run or status change: the confirm step must not
              // survive into a different run, or a run that already moved on.
              key={`${selected.id}-${selected.status}`}
              run={selected}
              organizationSlug={organizationSlug}
              busy={busy}
              onStatusChange={(status) => handleStatusChange(selected.id, status)}
              onReorder={(orderIds) => handleReorder(selected.id, orderIds)}
              onAssignDriver={(driverId) => handleAssignDriver(selected.id, driverId)}
              drivers={drivers}
            />
          )}
        </div>
      )}
    </div>
  );
}
