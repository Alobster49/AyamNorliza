"use client";

import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";
import { Check } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import type { DispatchBoardData } from "../types";
import { buildLoadBoard, type LoadJob, type LoadLane } from "../lib/loading-model";
import { getDispatchBoard, setOrderLoaded } from "../server/dispatch-actions";
import { Link } from "@/i18n/navigation";
import { HenEmptyState } from "@/components/shared/hen-empty-state";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function kg(value: number): string {
  return value.toFixed(1);
}

/** Spring shared by every layout move on the board (matches cart-overlay). */
const laneSpring = { type: "spring", bounce: 0, duration: 0.35 } as const;

/** Conic-gradient progress ring — done count over total for one truck. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const deg = total > 0 ? (done / total) * 360 : 0;
  const complete = total > 0 && done === total;
  return (
    <div
      aria-hidden
      className="load-ring grid size-14 shrink-0 place-items-center rounded-full"
      style={
        {
          "--ring-deg": `${deg}deg`,
          "--ring-color": complete ? "var(--color-success)" : "var(--primary)",
        } as CSSProperties
      }
    >
      <div className="grid size-11 place-items-center rounded-full bg-card text-xs font-semibold tabular-nums">
        {complete ? (
          <Check className="size-5 animate-in fade-in zoom-in-75 duration-300 text-[color:var(--color-success)] motion-reduce:animate-none" />
        ) : (
          `${done}/${total}`
        )}
      </div>
    </div>
  );
}

/** Loaded weight, then the rest of the day's load, against truck capacity. */
function CapacityBar({ lane }: { lane: LoadLane }) {
  const t = useTranslations("loadingBoard.capacity");
  const hasCap = lane.capacityKg !== null && lane.capacityKg > 0;
  const loadedPct = hasCap
    ? (lane.loadedPct ?? 0)
    : lane.totalKg > 0
      ? (lane.loadedKg / lane.totalKg) * 100
      : 0;
  const plannedPct = hasCap ? (lane.plannedPct ?? 0) : 100;

  return (
    <div className="mt-1.5">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full transition-[width] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
            lane.overCapacity ? "bg-destructive" : "bg-primary",
          )}
          style={{ width: `${loadedPct}%` }}
        />
        <div
          className={cn(
            "h-full transition-[width] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
            lane.overCapacity ? "bg-destructive/30" : "bg-primary/25",
          )}
          style={{ width: `${Math.max(0, plannedPct - loadedPct)}%` }}
        />
      </div>
      <p className="mt-1 text-xs tabular-nums text-muted-foreground">
        {t("onBoard", { loaded: kg(lane.loadedKg), total: kg(lane.totalKg) })}
        {lane.capacityKg !== null ? (
          lane.overCapacity ? (
            <span className="font-medium text-destructive">
              {t("overCapacityBy", { kg: kg(lane.totalKg - lane.capacityKg) })}
            </span>
          ) : (
            <span>{t("freeOf", { free: kg(lane.freeKg ?? 0), capacity: kg(lane.capacityKg) })}</span>
          )
        ) : null}
      </p>
    </div>
  );
}

function JobCard({
  job,
  isNext,
  disabled,
  organizationSlug,
  onToggle,
}: {
  job: LoadJob;
  isNext: boolean;
  disabled: boolean;
  organizationSlug: string;
  onToggle: (loaded: boolean) => void;
}) {
  const t = useTranslations("loadingBoard.job");
  const tPlan = useTranslations("logistics.dispatch.plan");
  const name = job.ticket.customer?.name ?? tPlan("orderFallback");
  const weighed = job.weightKg !== null;

  if (job.loaded) {
    return (
      <button
        type="button"
        disabled={disabled}
        aria-label={t("undoLoadingAria", { name })}
        onClick={() => onToggle(false)}
        className="flex w-full items-center gap-3 rounded-xl border border-dashed p-3 text-left opacity-60 transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.99] disabled:pointer-events-none motion-reduce:transition-none motion-reduce:active:scale-100"
      >
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">
          {job.dropNumber}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground line-through">{name}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {weighed ? `${kg(job.weightKg!)} kg` : "—"}
        </span>
        <span className="shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          {t("undo")}
        </span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border bg-card shadow-sm transition-colors",
        isNext ? "border-primary ring-2 ring-primary/25" : "hover:border-primary/40",
      )}
    >
      <button
        type="button"
        disabled={disabled}
        aria-label={t("markLoadedAria", { name })}
        onClick={() => onToggle(true)}
        className="grid min-h-16 w-full grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 rounded-xl p-3 text-left transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.98] disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100"
      >
        <span
          className={cn(
            "row-span-2 grid size-7 place-items-center rounded-md text-xs font-semibold tabular-nums",
            isNext ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          {job.dropNumber}
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[15px] font-semibold leading-tight">{name}</span>
          {isNext ? (
            <span className="shrink-0 rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">
              {t("next")}
            </span>
          ) : null}
        </span>
        <span className="row-span-2 text-right text-lg font-semibold tabular-nums leading-none">
          {weighed ? kg(job.weightKg!) : "—"}
          <span className="block text-[10px] font-medium tracking-wide text-muted-foreground">KG</span>
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {job.ticket.zone?.name ? `${job.ticket.zone.name} · ` : ""}
          {job.slotStart ? `${job.slotStart} · ` : ""}
          {t("dropOf", { drop: job.dropNumber, total: job.totalDrops })}
        </span>
      </button>

      {!weighed ? (
        <Link
          href={`/${organizationSlug}/tasks?order=${job.ticket.id}`}
          className="mx-3 mb-3 flex min-h-11 items-center justify-between gap-2 rounded-lg bg-amber-100 px-3 text-[11px] font-semibold uppercase tracking-wide text-amber-800 transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900"
        >
          <span>{t("notWeighedYet")}</span>
          <span aria-hidden>{t("weighNow")}</span>
          <span className="sr-only">{t("weighNowAria", { name })}</span>
        </Link>
      ) : null}
    </div>
  );
}

function Lane({
  lane,
  pendingIds,
  organizationSlug,
  onToggle,
}: {
  lane: LoadLane;
  pendingIds: ReadonlySet<string>;
  organizationSlug: string;
  onToggle: (orderId: string, loaded: boolean) => void;
}) {
  const t = useTranslations("loadingBoard.lane");
  const tStatusRun = useTranslations("status.run");
  const reduceMotion = useReducedMotion();
  const allLoaded = !lane.departed && lane.totalCount > 0 && lane.doneCount === lane.totalCount;

  return (
    <section
      className="flex w-[86vw] max-w-sm shrink-0 snap-start flex-col rounded-2xl border bg-muted/30 md:w-auto md:min-w-80 md:max-w-md md:flex-1 md:shrink"
      aria-label={t("ariaLabel", { truck: lane.truck.name, done: lane.doneCount, total: lane.totalCount })}
    >
      <header className="flex items-center gap-3 border-b p-3">
        <ProgressRing done={lane.doneCount} total={lane.totalCount} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold leading-tight">{lane.truck.name}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {lane.truck.code} · {lane.bayName}
            {lane.departed ? ` · ${tStatusRun("departed")}` : ""}
          </p>
          <CapacityBar lane={lane} />
        </div>
      </header>

      {lane.departed ? (
        <p className="p-4 text-sm text-muted-foreground">{t("departedNotice")}</p>
      ) : (
        <div className="flex flex-col gap-2 p-2">
          {allLoaded ? (
            <p className="flex items-center gap-1.5 px-1.5 pt-1 text-xs font-medium text-[color:var(--color-success)] animate-in fade-in duration-300 motion-reduce:animate-none">
              <Check aria-hidden className="size-3.5" />
              {t("allLoaded")}
            </p>
          ) : null}
          {lane.jobs.map((job) => (
            <motion.div key={job.ticket.id} layout={!reduceMotion} transition={laneSpring}>
              <JobCard
                job={job}
                isNext={job.ticket.id === lane.nextJobId}
                disabled={pendingIds.has(job.ticket.id)}
                organizationSlug={organizationSlug}
                onToggle={(loaded) => onToggle(job.ticket.id, loaded)}
              />
            </motion.div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Trucks on the board with nothing assigned — parked as a quiet strip so
 *  they never crowd out the lanes that have real work. */
function IdleStrip({ lanes }: { lanes: LoadLane[] }) {
  const t = useTranslations("loadingBoard.idle");
  const tStatusRun = useTranslations("status.run");
  if (lanes.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" aria-label={t("title")}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("title")}
      </h2>
      <div className="flex flex-wrap gap-2">
        {lanes.map((lane) => (
          <div
            key={lane.truck.id}
            className="flex items-baseline gap-2 rounded-lg border border-dashed bg-muted/30 px-3 py-2"
          >
            <span className="text-sm font-medium">{lane.truck.name}</span>
            <span className="text-xs text-muted-foreground">
              {lane.truck.code} · {lane.bayName}
              {lane.departed ? ` · ${tStatusRun("departed")}` : ""}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function LoadingClient({
  organizationSlug,
  initialDate,
  initialData,
}: {
  organizationSlug: string;
  initialDate: string;
  initialData: DispatchBoardData;
}) {
  const date = initialDate; // loading is always today
  const tEmpty = useTranslations("loadingBoard.empty");
  const tToast = useTranslations("loadingBoard.toast");
  const tSummary = useTranslations("loadingBoard.summary");
  const tLogistics = useTranslations("logistics");
  const tPlan = useTranslations("logistics.dispatch.plan");
  const tSetupToasts = useTranslations("logistics.setup.toasts");
  const tDash = useTranslations("dashboard.pages");
  const format = useFormatter();
  const [data, setData] = useState(initialData);
  const { toast } = useToast();

  // Guards for optimistic toggles: pendingRef blocks double-fires on the same
  // order, inFlightRef keeps a refetch from clobbering a newer optimistic flip.
  const pendingRef = useRef(new Set<string>());
  const inFlightRef = useRef(0);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());

  const setLoadedLocal = useCallback((orderId: string, loaded: boolean) => {
    setData((prev) => ({
      ...prev,
      orders: prev.orders.map((order) =>
        order.id === orderId
          ? { ...order, loaded_at: loaded ? new Date().toISOString() : null }
          : order,
      ),
    }));
  }, []);

  const refetch = useCallback(async () => {
    const result = await getDispatchBoard(organizationSlug, date);
    if (inFlightRef.current > 0) return; // stale — a newer toggle is mid-flight
    if (result.ok) setData(result.data);
    else toast({ title: tLogistics("error"), description: result.message, variant: "destructive" });
  }, [organizationSlug, date, toast, tLogistics]);

  /** Optimistic write: flip locally, confirm with the server, reconcile after. */
  const applyLoaded = useCallback(
    async (orderId: string, loaded: boolean): Promise<boolean> => {
      if (pendingRef.current.has(orderId)) return false;
      pendingRef.current.add(orderId);
      setPendingIds(new Set(pendingRef.current));
      inFlightRef.current += 1;
      setLoadedLocal(orderId, loaded);
      try {
        const result = await setOrderLoaded(organizationSlug, { orderId, loaded });
        if (!result.ok) {
          setLoadedLocal(orderId, !loaded);
          toast({ title: tToast("couldNotUpdateTitle"), description: result.message, variant: "destructive" });
        }
        return result.ok;
      } catch {
        setLoadedLocal(orderId, !loaded);
        toast({ title: tToast("couldNotUpdateTitle"), variant: "destructive" });
        return false;
      } finally {
        pendingRef.current.delete(orderId);
        setPendingIds(new Set(pendingRef.current));
        inFlightRef.current -= 1;
        if (inFlightRef.current === 0) void refetch();
      }
    },
    [organizationSlug, refetch, setLoadedLocal, toast, tToast],
  );

  const toggle = useCallback(
    (orderId: string, loaded: boolean, name?: string) => {
      void (async () => {
        const ok = await applyLoaded(orderId, loaded);
        if (!ok || !loaded) return;
        toast({
          title: tToast("loadedTitle", { name: name ?? tPlan("orderFallback") }),
          action: (
            <ToastAction
              altText={tSetupToasts("undo")}
              onClick={() => void applyLoaded(orderId, false)}
            >
              {tSetupToasts("undo")}
            </ToastAction>
          ),
        });
      })();
    },
    [applyLoaded, toast, tToast, tPlan, tSetupToasts],
  );

  const lanes = useMemo(() => buildLoadBoard(data, date), [data, date]);

  // Lanes with work first (bay order preserved), departed lanes after them,
  // idle trucks off the board entirely.
  const { boardLanes, idleLanes } = useMemo(() => {
    const working = lanes.filter((lane) => lane.totalCount > 0 && !lane.departed);
    const departed = lanes.filter((lane) => lane.totalCount > 0 && lane.departed);
    const idle = lanes.filter((lane) => lane.totalCount === 0);
    return { boardLanes: [...working, ...departed], idleLanes: idle };
  }, [lanes]);

  const totals = useMemo(
    () =>
      boardLanes.reduce(
        (acc, lane) => ({ done: acc.done + lane.doneCount, total: acc.total + lane.totalCount }),
        { done: 0, total: 0 },
      ),
    [boardLanes],
  );

  const nameFor = useCallback(
    (orderId: string) =>
      lanes
        .flatMap((lane) => lane.jobs)
        .find((job) => job.ticket.id === orderId)?.ticket.customer?.name,
    [lanes],
  );

  // Noon Kuala Lumpur pins the calendar day no matter what timezone the
  // server or browser runs in; the formatter is already zoned to KL.
  const dateLabel = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? format.dateTime(new Date(`${date}T12:00:00+08:00`), {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : date;

  if (lanes.length === 0) {
    return (
      <div className="flex w-full flex-1 flex-col">
        <h1 className="text-lg font-semibold">{tDash("loading")}</h1>
        <HenEmptyState title={tEmpty("title")} subtitle={tEmpty("subtitle")} className="flex-1 py-20" />
      </div>
    );
  }

  const boardComplete = totals.total > 0 && totals.done === totals.total;

  return (
    <div className="flex w-full flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold">{tDash("loading")}</h1>
          <p className="text-xs text-muted-foreground">{dateLabel}</p>
          {totals.total > 0 ? (
            <p role="status" aria-live="polite" className="text-xs tabular-nums text-muted-foreground">
              {tSummary("loadedAcross", { done: totals.done, total: totals.total, count: boardLanes.length })}
            </p>
          ) : null}
        </div>
        {totals.total > 0 ? (
          <div aria-hidden className="h-1 w-full max-w-sm overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-[width,background-color] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
                boardComplete ? "bg-[color:var(--color-success)]" : "bg-primary",
              )}
              style={{ width: `${(totals.done / totals.total) * 100}%` }}
            />
          </div>
        ) : null}
      </header>

      {boardLanes.length === 0 ? (
        <HenEmptyState title={tEmpty("noLoadTitle")} subtitle={tEmpty("subtitle")} className="py-14" />
      ) : (
        <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-1 pb-3 md:snap-none">
          {boardLanes.map((lane) => (
            <Lane
              key={lane.truck.id}
              lane={lane}
              pendingIds={pendingIds}
              organizationSlug={organizationSlug}
              onToggle={(orderId, loaded) => toggle(orderId, loaded, nameFor(orderId))}
            />
          ))}
        </div>
      )}

      {boardLanes.length > 1 ? (
        <p className="-mt-2 text-center text-xs text-muted-foreground md:hidden">{tSummary("swipeHint")}</p>
      ) : null}

      <IdleStrip lanes={idleLanes} />
    </div>
  );
}
