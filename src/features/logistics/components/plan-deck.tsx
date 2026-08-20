"use client";

import { useMemo, useState, useTransition } from "react";
import type { DispatchBoardData } from "../types";
import { buildBoardView, type BoardTruck } from "../lib/dispatch-board-model";
import { draftPlan, orderWeightKg, totalWeightKg, type PlanDraft } from "../lib/plan-model";
import { applyPlan, assignOrder, departTruck } from "../server/dispatch-actions";
import { useToast } from "@/hooks/use-toast";

function Dial({ pct, label }: { pct: number; label: string }) {
  const clamped = Math.min(Math.max(pct, 0), 100);
  const tone = clamped >= 95 ? "var(--destructive)" : "var(--primary)";
  return (
    <div
      className="grid size-12 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums"
      style={{ background: `conic-gradient(${tone} ${clamped}%, var(--muted) ${clamped}% 100%)` }}
      role="img"
      aria-label={label}
    >
      <span className="grid size-9 place-items-center rounded-full bg-card">{Math.round(clamped)}%</span>
    </div>
  );
}

function TruckPlanCard({
  bt,
  incoming,
  onDepart,
  departPending,
}: {
  bt: BoardTruck;
  incoming: number;
  onDepart: () => void;
  departPending: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const kg = totalWeightKg(bt.tickets);
  const notReady = bt.tickets.filter((t) => t.status !== "ready").length;
  const pct =
    bt.truck.capacity_kg !== null && bt.truck.capacity_kg > 0
      ? (kg / bt.truck.capacity_kg) * 100
      : bt.cap !== null && bt.cap > 0
        ? (bt.load / bt.cap) * 100
        : 0;

  return (
    <article className="flex flex-col gap-3 rounded-lg border bg-card p-3">
      <div className="flex items-center gap-3">
        <Dial pct={pct} label={`${bt.truck.name} load`} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{bt.truck.name}</p>
          <p className="text-xs text-muted-foreground">
            {bt.truck.code}
            {bt.truck.capacity_kg !== null ? ` · ${kg.toFixed(1)} / ${bt.truck.capacity_kg} kg` : kg > 0 ? ` · ${kg.toFixed(1)} kg` : ""}
            {" · "}
            {bt.load}
            {bt.cap !== null ? `/${bt.cap}` : ""} orders
            {incoming > 0 ? ` · +${incoming} proposed` : ""}
          </p>
        </div>
      </div>

      <ul className="flex flex-col gap-1">
        {bt.tickets.slice(0, 5).map((t) => (
          <li key={t.id} className="flex items-center gap-2 rounded bg-muted/50 px-2 py-1 text-xs">
            <span className="truncate">{t.customer?.name ?? "Customer"}</span>
            {t.loaded_at ? <span className="text-green-700 dark:text-green-400">loaded</span> : null}
            <span className="ml-auto tabular-nums text-muted-foreground">
              {orderWeightKg(t) !== null ? `${orderWeightKg(t)!.toFixed(1)} kg` : "—"}
            </span>
          </li>
        ))}
        {bt.tickets.length > 5 ? (
          <li className="px-2 text-xs text-muted-foreground">+{bt.tickets.length - 5} more</li>
        ) : null}
        {bt.tickets.length === 0 ? <li className="px-2 text-xs text-muted-foreground">No orders yet.</li> : null}
      </ul>

      {bt.departed ? (
        <p className="rounded border border-dashed px-2 py-1.5 text-xs text-muted-foreground">
          On the road with {bt.load} order{bt.load === 1 ? "" : "s"}
        </p>
      ) : confirming ? (
        <div className="flex gap-2">
          <button
            type="button"
            className="min-h-9 flex-1 rounded border px-2 text-xs"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="min-h-9 flex-1 rounded bg-primary px-2 text-xs text-primary-foreground"
            onClick={() => {
              setConfirming(false);
              onDepart();
            }}
          >
            Depart, leave {notReady} behind
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={departPending || !bt.tickets.some((t) => t.status === "ready")}
          className="min-h-9 rounded bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-40"
          onClick={() => (notReady > 0 ? setConfirming(true) : onDepart())}
        >
          Depart · {bt.tickets.filter((t) => t.status === "ready").length} of {bt.load} ready
        </button>
      )}
    </article>
  );
}

export function PlanDeck({
  organizationSlug,
  date,
  data,
  refetch,
}: {
  organizationSlug: string;
  date: string;
  data: DispatchBoardData;
  refetch: () => void;
}) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [dismissed, setDismissed] = useState(false);

  const view = useMemo(() => buildBoardView(data, date), [data, date]);
  const draft: PlanDraft = useMemo(() => draftPlan(data, date), [data, date]);
  const orderById = useMemo(() => new Map(data.orders.map((o) => [o.id, o])), [data.orders]);
  const truckById = useMemo(() => new Map(data.trucks.map((t) => [t.id, t])), [data.trucks]);
  const incomingByTruck = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of draft.proposals) m.set(p.truckId, (m.get(p.truckId) ?? 0) + 1);
    return m;
  }, [draft.proposals]);

  const boardTrucks = view.bays.flatMap((b) => b.trucks);

  const acceptAll = () => {
    startTransition(async () => {
      const result = await applyPlan(organizationSlug, {
        assignments: draft.proposals.map((p) => ({ orderId: p.orderId, truckId: p.truckId })),
      });
      if (!result.ok) {
        toast({ title: "Plan failed", description: result.message, variant: "destructive" });
      } else if (result.data.failed.length > 0) {
        toast({
          title: `Applied ${result.data.applied}, ${result.data.failed.length} failed`,
          description: result.data.failed[0]!.message,
          variant: "destructive",
        });
      } else {
        toast({ title: `Assigned ${result.data.applied} orders` });
      }
      refetch();
    });
  };

  const overrideAssign = (orderId: string, truckId: string) => {
    startTransition(async () => {
      const result = await assignOrder(organizationSlug, { orderId, truckId });
      if (!result.ok) toast({ title: "Assign failed", description: result.message, variant: "destructive" });
      refetch();
    });
  };

  const depart = (truckId: string) => {
    startTransition(async () => {
      const result = await departTruck(organizationSlug, { truckId, date });
      if (!result.ok) toast({ title: "Depart failed", description: result.message, variant: "destructive" });
      refetch();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {draft.proposals.length > 0 && !dismissed ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-accent/60 p-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              Draft plan ready — {draft.proposals.length} of {draft.poolCount} orders placed
            </p>
            <p className="text-xs text-muted-foreground">
              {draft.exceptions.length > 0
                ? `${draft.exceptions.length} need a decision below.`
                : "Everything in the pool has a truck."}
            </p>
          </div>
          <div className="ml-auto flex gap-2">
            <button type="button" className="min-h-9 rounded border px-3 text-sm" onClick={() => setDismissed(true)}>
              Dismiss
            </button>
            <button
              type="button"
              disabled={isPending}
              className="min-h-9 rounded bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
              onClick={acceptAll}
            >
              Accept {draft.proposals.length}
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <aside className="flex flex-col gap-2">
          {draft.exceptions.length > 0 ? (
            <>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Needs a decision · {draft.exceptions.length}
              </h2>
              {draft.exceptions.map((ex) => {
                const o = orderById.get(ex.orderId);
                return (
                  <div key={ex.orderId} className="flex flex-col gap-2 rounded-lg border border-l-4 border-l-amber-500 bg-card p-3">
                    <p className="text-sm font-medium">{o?.customer?.name ?? "Order"}</p>
                    <p className="text-xs text-muted-foreground">{ex.detail}</p>
                    {(ex.kind === "no_covering_truck" || ex.kind === "all_trucks_full") && (
                      <select
                        className="min-h-9 rounded border bg-background px-2 text-xs"
                        defaultValue=""
                        disabled={isPending}
                        onChange={(e) => {
                          if (e.target.value) overrideAssign(ex.orderId, e.target.value);
                        }}
                      >
                        <option value="" disabled>
                          Override onto…
                        </option>
                        {boardTrucks
                          .filter((bt) => !bt.departed)
                          .map((bt) => (
                            <option key={bt.truck.id} value={bt.truck.id}>
                              {bt.truck.name} ({bt.truck.code})
                            </option>
                          ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </>
          ) : null}

          <h2 className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Proposed · {draft.proposals.length}
          </h2>
          {draft.proposals.map((p) => {
            const o = orderById.get(p.orderId);
            return (
              <div key={p.orderId} className="rounded-lg border border-l-4 border-l-primary bg-card p-3">
                <p className="text-sm font-medium">
                  {o?.customer?.name ?? "Order"} → {truckById.get(p.truckId)?.name ?? "truck"}
                </p>
                <p className="text-xs text-muted-foreground">{p.reason}</p>
              </div>
            );
          })}
          {draft.poolCount === 0 ? (
            <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              Pool is empty — every order for this date has a truck.
            </p>
          ) : null}
        </aside>

        <div className="grid content-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {boardTrucks.map((bt) => (
            <TruckPlanCard
              key={bt.truck.id}
              bt={bt}
              incoming={incomingByTruck.get(bt.truck.id) ?? 0}
              onDepart={() => depart(bt.truck.id)}
              departPending={isPending}
            />
          ))}
          {boardTrucks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active trucks in any bay.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
