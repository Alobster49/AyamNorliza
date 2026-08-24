"use client";

import Link from "next/link";
import { useCallback, useMemo, useState, useTransition } from "react";
import type { DispatchBoardData } from "../types";
import { buildLoadBoard, type LoadJob, type LoadLane } from "../lib/loading-model";
import { getDispatchBoard, setOrderLoaded } from "../server/dispatch-actions";
import { useTranslations } from "next-intl";
import { HenEmptyState } from "@/components/shared/hen-empty-state";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function kg(value: number): string {
  return value.toFixed(1);
}

/** Conic-gradient progress ring — done count over total for one truck. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const deg = total > 0 ? (done / total) * 360 : 0;
  const complete = total > 0 && done === total;
  return (
    <div
      aria-hidden
      className="grid size-14 shrink-0 place-items-center rounded-full transition-[background] motion-reduce:transition-none"
      style={{
        background: `conic-gradient(var(--${complete ? "color-success" : "primary"}) ${deg}deg, var(--muted) 0deg)`,
      }}
    >
      <div className="grid size-11 place-items-center rounded-full bg-card text-xs font-semibold tabular-nums">
        {done}/{total}
      </div>
    </div>
  );
}

/** Loaded weight, then the rest of the day's load, against truck capacity. */
function CapacityBar({ lane }: { lane: LoadLane }) {
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
            "h-full transition-[width] duration-300 motion-reduce:transition-none",
            lane.overCapacity ? "bg-destructive" : "bg-primary",
          )}
          style={{ width: `${loadedPct}%` }}
        />
        <div
          className={cn(
            "h-full transition-[width] duration-300 motion-reduce:transition-none",
            lane.overCapacity ? "bg-destructive/30" : "bg-primary/25",
          )}
          style={{ width: `${Math.max(0, plannedPct - loadedPct)}%` }}
        />
      </div>
      <p className="mt-1 text-xs tabular-nums text-muted-foreground">
        {kg(lane.loadedKg)} / {kg(lane.totalKg)} kg on board
        {lane.capacityKg !== null ? (
          lane.overCapacity ? (
            <span className="font-medium text-destructive">
              {" · over capacity by "}
              {kg(lane.totalKg - lane.capacityKg)} kg
            </span>
          ) : (
            <span> · {kg(lane.freeKg ?? 0)} kg free of {kg(lane.capacityKg)}</span>
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
  const name = job.ticket.customer?.name ?? "Order";
  const weighed = job.weightKg !== null;

  if (job.loaded) {
    return (
      <button
        type="button"
        disabled={disabled}
        aria-label={`Undo loading ${name}`}
        onClick={() => onToggle(false)}
        className="flex w-full items-center gap-3 rounded-xl border border-dashed p-3 text-left opacity-60 transition-opacity hover:opacity-100 disabled:pointer-events-none motion-reduce:transition-none"
      >
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">
          {job.dropNumber}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground line-through">{name}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {weighed ? `${kg(job.weightKg!)} kg` : "—"}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">undo</span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border bg-card shadow-sm",
        isNext && "border-primary ring-2 ring-primary/25",
      )}
    >
      <button
        type="button"
        disabled={disabled}
        aria-label={`Mark ${name} loaded`}
        onClick={() => onToggle(true)}
        className="grid min-h-16 w-full grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 rounded-xl p-3 text-left transition-transform active:scale-[0.985] disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100"
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
              Next
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
          drop {job.dropNumber} of {job.totalDrops}
        </span>
      </button>

      {!weighed ? (
        <Link
          href={`/${organizationSlug}/tasks?order=${job.ticket.id}`}
          className="mx-3 mb-3 flex min-h-11 items-center justify-between gap-2 rounded-lg bg-amber-100 px-3 text-[11px] font-semibold uppercase tracking-wide text-amber-800 hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900"
        >
          <span>Not weighed yet</span>
          <span aria-hidden>Weigh now →</span>
          <span className="sr-only">— open the weigh station for {name}</span>
        </Link>
      ) : null}
    </div>
  );
}

function Lane({
  lane,
  pending,
  organizationSlug,
  onToggle,
}: {
  lane: LoadLane;
  pending: boolean;
  organizationSlug: string;
  onToggle: (orderId: string, loaded: boolean) => void;
}) {
  return (
    <section
      className="flex w-full shrink-0 snap-start flex-col rounded-2xl border bg-muted/30 md:w-auto md:flex-1 md:shrink"
      aria-label={`${lane.truck.name}, ${lane.doneCount} of ${lane.totalCount} loaded`}
    >
      <header className="flex items-center gap-3 border-b p-3">
        <ProgressRing done={lane.doneCount} total={lane.totalCount} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold leading-tight">{lane.truck.name}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {lane.truck.code} · {lane.bayName}
            {lane.departed ? " · on the road" : ""}
          </p>
          <CapacityBar lane={lane} />
        </div>
      </header>

      {lane.departed ? (
        <p className="p-4 text-sm text-muted-foreground">This truck has departed — loading is closed.</p>
      ) : lane.jobs.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">Nothing assigned to this truck yet.</p>
      ) : (
        <div className="flex flex-col gap-2 p-2">
          {lane.jobs.map((job) => (
            <JobCard
              key={job.ticket.id}
              job={job}
              isNext={job.ticket.id === lane.nextJobId}
              disabled={pending}
              organizationSlug={organizationSlug}
              onToggle={(loaded) => onToggle(job.ticket.id, loaded)}
            />
          ))}
        </div>
      )}
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
  const [data, setData] = useState(initialData);
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  const refetch = useCallback(() => {
    startTransition(async () => {
      const result = await getDispatchBoard(organizationSlug, date);
      if (result.ok) setData(result.data);
      else toast({ title: "Error", description: result.message, variant: "destructive" });
    });
  }, [organizationSlug, date, toast]);

  const lanes = useMemo(() => buildLoadBoard(data, date), [data, date]);

  /** Writes the flag and refetches; returns false when the server refused. */
  const applyLoaded = useCallback(
    async (orderId: string, loaded: boolean): Promise<boolean> => {
      const result = await setOrderLoaded(organizationSlug, { orderId, loaded });
      if (!result.ok) {
        toast({ title: "Could not update", description: result.message, variant: "destructive" });
      }
      refetch();
      return result.ok;
    },
    [organizationSlug, refetch, toast],
  );

  const toggle = useCallback(
    (orderId: string, loaded: boolean, name?: string) => {
      startTransition(async () => {
        const ok = await applyLoaded(orderId, loaded);
        if (!ok || !loaded) return;
        toast({
          title: `${name ?? "Order"} loaded`,
          action: (
            <ToastAction
              altText="Undo"
              onClick={() => startTransition(() => void applyLoaded(orderId, false))}
            >
              Undo
            </ToastAction>
          ),
        });
      });
    },
    [applyLoaded, toast],
  );

  const totals = useMemo(
    () =>
      lanes.reduce(
        (acc, lane) => ({ done: acc.done + lane.doneCount, total: acc.total + lane.totalCount }),
        { done: 0, total: 0 },
      ),
    [lanes],
  );

  const nameFor = useCallback(
    (orderId: string) =>
      lanes
        .flatMap((lane) => lane.jobs)
        .find((job) => job.ticket.id === orderId)?.ticket.customer?.name,
    [lanes],
  );

  if (lanes.length === 0) {
    return (
      <div className="flex w-full flex-1 flex-col">
        <h1 className="text-lg font-semibold">Loading</h1>
        <HenEmptyState title={tEmpty("title")} subtitle={tEmpty("subtitle")} className="flex-1 py-20" />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex items-baseline gap-3">
        <h1 className="text-lg font-semibold">Loading</h1>
        <p className="text-xs tabular-nums text-muted-foreground">
          {totals.done} of {totals.total} loaded across {lanes.length}{" "}
          {lanes.length === 1 ? "truck" : "trucks"}
        </p>
      </div>

      <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 md:snap-none md:overflow-x-visible">
        {lanes.map((lane) => (
          <Lane
            key={lane.truck.id}
            lane={lane}
            pending={isPending}
            organizationSlug={organizationSlug}
            onToggle={(orderId, loaded) => toggle(orderId, loaded, nameFor(orderId))}
          />
        ))}
      </div>

      {lanes.length > 1 ? (
        <p className="text-center text-xs text-muted-foreground md:hidden">Swipe for the next truck</p>
      ) : null}
    </div>
  );
}
