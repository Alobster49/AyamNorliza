"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import type { DispatchBoardData } from "../types";
import { buildLoadQueue, truckSummaries, type LoadJob } from "../lib/loading-model";
import { getDispatchBoard, setOrderLoaded } from "../server/dispatch-actions";
import { useToast } from "@/hooks/use-toast";

function JobCard({
  job,
  pending,
  onToggle,
}: {
  job: LoadJob;
  pending: boolean;
  onToggle: (loaded: boolean) => void;
}) {
  if (job.loaded) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed bg-muted/40 p-3">
        <span className="text-sm text-muted-foreground line-through">{job.ticket.customer?.name ?? "Order"}</span>
        <span className="text-xs text-green-700 dark:text-green-400">loaded</span>
        <button
          type="button"
          disabled={pending}
          className="ml-auto min-h-11 rounded-lg border px-3 text-sm"
          onClick={() => onToggle(false)}
        >
          Undo
        </button>
      </div>
    );
  }

  return (
    <article className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm">
      <div>
        <h3 className="text-xl font-semibold leading-tight">{job.ticket.customer?.name ?? "Order"}</h3>
        <p className="text-xs text-muted-foreground">
          {job.ticket.zone?.name ? `${job.ticket.zone.name} · ` : ""}
          {job.ticket.postcode ?? "no postcode"}
          {job.slotStart ? ` · slot ${job.slotStart}` : ""}
        </p>
      </div>

      <div className="flex items-baseline gap-2 rounded-xl border bg-muted/50 px-4 py-3">
        <span className="text-4xl font-bold tabular-nums leading-none">
          {job.weightKg !== null ? job.weightKg.toFixed(1) : "—"}
        </span>
        <span className="text-sm text-muted-foreground">kg</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {job.ticket.status === "ready" ? "weighed & ready" : "not weighed yet"}
        </span>
      </div>

      <ul className="flex flex-col gap-1.5">
        {job.lines.map((line, i) => (
          <li key={i} className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span className="truncate">{line.name}</span>
            <span className="ml-auto tabular-nums text-muted-foreground">
              {line.pieces !== null ? `${line.pieces} pcs` : `×${line.quantity}`}
              {line.weightKg !== null ? ` · ${line.weightKg.toFixed(1)} kg` : ""}
            </span>
          </li>
        ))}
        {job.lines.length === 0 ? <li className="px-3 text-sm text-muted-foreground">No items.</li> : null}
      </ul>

      <button
        type="button"
        disabled={pending}
        className="min-h-14 rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
        onClick={() => onToggle(true)}
      >
        Loaded ✓
      </button>
    </article>
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
  const [data, setData] = useState(initialData);
  const [truckId, setTruckId] = useState<string | null>(null);
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  const refetch = useCallback(() => {
    startTransition(async () => {
      const result = await getDispatchBoard(organizationSlug, date);
      if (result.ok) setData(result.data);
      else toast({ title: "Error", description: result.message, variant: "destructive" });
    });
  }, [organizationSlug, date, toast]);

  const summaries = useMemo(() => truckSummaries(data, date), [data, date]);
  const queue = useMemo(
    () => (truckId ? buildLoadQueue(data, date, truckId) : null),
    [data, date, truckId],
  );

  const toggle = (orderId: string, loaded: boolean) => {
    startTransition(async () => {
      const result = await setOrderLoaded(organizationSlug, { orderId, loaded });
      if (!result.ok) toast({ title: "Could not update", description: result.message, variant: "destructive" });
      refetch();
    });
  };

  if (!queue) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-3">
        <h1 className="text-lg font-semibold">Loading</h1>
        <p className="text-sm text-muted-foreground">Pick your truck to start loading.</p>
        {summaries.map((s) => (
          <button
            key={s.truck.id}
            type="button"
            disabled={s.departed}
            className="flex min-h-16 items-center gap-3 rounded-2xl border bg-card p-4 text-left shadow-sm disabled:opacity-50"
            onClick={() => setTruckId(s.truck.id)}
          >
            <div className="min-w-0">
              <p className="truncate font-semibold">{s.truck.name}</p>
              <p className="text-xs text-muted-foreground">
                {s.truck.code} · {s.bayName}
                {s.departed ? " · on the road" : ""}
              </p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-sm font-semibold tabular-nums">
                {s.doneCount}/{s.totalCount}
              </p>
              <p className="text-xs tabular-nums text-muted-foreground">
                {s.totalKg > 0 ? `${s.totalKg.toFixed(1)} kg` : "—"}
              </p>
            </div>
          </button>
        ))}
        {summaries.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No trucks on the board today.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 lg:max-w-2xl">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="min-h-11 rounded-lg border px-3 text-sm"
          onClick={() => setTruckId(null)}
        >
          ← Trucks
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span className="truncate font-medium text-foreground">
              {queue.truck.name} · {queue.truck.code}
            </span>
            <span className="tabular-nums">
              {queue.doneCount} of {queue.totalCount} loaded
              {queue.totalKg > 0 ? ` · ${queue.loadedKg.toFixed(1)}/${queue.totalKg.toFixed(1)} kg` : ""}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all motion-reduce:transition-none"
              style={{ width: `${queue.totalCount > 0 ? (queue.doneCount / queue.totalCount) * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>

      {queue.departed ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          This truck has departed — loading is closed.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {queue.jobs.map((job) => (
            <JobCard
              key={job.ticket.id}
              job={job}
              pending={isPending}
              onToggle={(loaded) => toggle(job.ticket.id, loaded)}
            />
          ))}
          {queue.jobs.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Nothing assigned to this truck yet.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
