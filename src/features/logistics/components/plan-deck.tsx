"use client";

import { useMemo, useState, useTransition, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { DispatchBoardData } from "../types";
import { buildBoardView, type BoardTruck } from "../lib/dispatch-board-model";
import { draftPlan, orderWeightKg, totalWeightKg, type PlanDraft } from "../lib/plan-model";
import { applyPlan, assignOrder, departTruck } from "../server/dispatch-actions";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

/** Load against truck capacity. Same animated dial as the runs board. */
function Dial({ pct, label }: { pct: number; label: string }) {
  const clamped = Math.min(Math.max(pct, 0), 100);
  const tone = pct > 100 ? "var(--destructive)" : pct >= 90 ? "var(--color-warning)" : "var(--primary)";
  return (
    <div
      className="run-dial grid size-12 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums"
      style={
        {
          "--dial-pct": `${clamped}%`,
          background: `conic-gradient(${tone} var(--dial-pct), var(--muted) var(--dial-pct) 100%)`,
        } as CSSProperties
      }
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
  const t = useTranslations("logistics.dispatch.plan");
  const tCommon = useTranslations("common");
  const kg = totalWeightKg(bt.tickets);
  const notReady = bt.tickets.filter((tk) => tk.status !== "ready").length;
  const readyCount = bt.tickets.filter((tk) => tk.status === "ready").length;
  const pct =
    bt.truck.capacity_kg !== null && bt.truck.capacity_kg > 0
      ? (kg / bt.truck.capacity_kg) * 100
      : bt.cap !== null && bt.cap > 0
        ? (bt.load / bt.cap) * 100
        : 0;

  return (
    <article
      className={`flex h-full flex-col gap-3 rounded-lg border bg-card p-3 transition-opacity duration-300 motion-reduce:transition-none ${
        bt.departed ? "border-dashed opacity-70" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <Dial pct={pct} label={t("loadLabel", { name: bt.truck.name })} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{bt.truck.name}</p>
          <p className="text-xs text-muted-foreground">
            {bt.truck.code}
            {bt.truck.capacity_kg !== null
              ? ` · ${t("weightFraction", { kg: kg.toFixed(1), capacity: bt.truck.capacity_kg })}`
              : kg > 0
                ? ` · ${t("weightOnly", { kg: kg.toFixed(1) })}`
                : ""}
            {" · "}
            {t("orderCount", { load: bt.load, capSuffix: bt.cap !== null ? `/${bt.cap}` : "" })}
            {incoming > 0 ? ` · ${t("proposedSuffix", { count: incoming })}` : ""}
          </p>
        </div>
      </div>

      <ul className="flex flex-col gap-1">
        {bt.tickets.slice(0, 5).map((tk) => (
          <li key={tk.id} className="flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1 text-xs">
            <span className="min-w-0 truncate">{tk.customer?.name ?? t("orderFallback")}</span>
            {tk.loaded_at ? (
              <span className="shrink-0 text-green-700 dark:text-green-400">{t("loaded")}</span>
            ) : null}
            <span className="ml-auto shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">
              {orderWeightKg(tk) !== null ? `${orderWeightKg(tk)!.toFixed(1)} kg` : "—"}
            </span>
          </li>
        ))}
        {bt.tickets.length > 5 ? (
          <li className="px-2 text-xs text-muted-foreground">{t("more", { count: bt.tickets.length - 5 })}</li>
        ) : null}
        {bt.tickets.length === 0 ? <li className="px-2 text-xs text-muted-foreground">{t("noOrdersYet")}</li> : null}
      </ul>

      {/* mt-auto pins the footer so Depart buttons line up across the row
          even when a neighbouring card lists more orders. */}
      <div className="mt-auto">
        {bt.departed ? (
          <p className="rounded-md border border-dashed px-2 py-1.5 text-xs text-muted-foreground">
            {t("onRoad", { count: bt.load })}
          </p>
        ) : confirming ? (
          <div className="animate-panel-in flex gap-2">
            <Button variant="outline" className="flex-1 text-xs" onClick={() => setConfirming(false)}>
              {tCommon("cancel")}
            </Button>
            <Button
              className="flex-1 text-xs"
              onClick={() => {
                setConfirming(false);
                onDepart();
              }}
            >
              {t("departLeaveBehind", { count: notReady })}
            </Button>
          </div>
        ) : (
          <Button
            disabled={departPending || readyCount === 0}
            className="w-full"
            onClick={() => (notReady > 0 ? setConfirming(true) : onDepart())}
          >
            {t("departButton", { ready: readyCount, load: bt.load })}
          </Button>
        )}
      </div>
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
  const t = useTranslations("logistics.dispatch.plan");
  const tRoot = useTranslations();
  // Dismissal belongs to the date it was made on. Plain boolean state would
  // survive a date change and silently hide the next day's draft, with a page
  // reload as the only way back.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const dismissed = dismissedFor === date;

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
        toast({
          title: t("planFailedToast"),
          description: result.messageKey ? tRoot(result.messageKey as never) : result.message,
          variant: "destructive",
        });
      } else if (result.data.failed.length > 0) {
        toast({
          title: t("appliedPartialToast", {
            applied: result.data.applied,
            failed: result.data.failed.length,
          }),
          description: result.data.failed[0]!.messageKey
            ? tRoot(result.data.failed[0]!.messageKey as never)
            : result.data.failed[0]!.message,
          variant: "destructive",
        });
      } else {
        toast({ title: t("assignedToast", { count: result.data.applied }) });
      }
      refetch();
    });
  };

  const overrideAssign = (orderId: string, truckId: string) => {
    startTransition(async () => {
      const result = await assignOrder(organizationSlug, { orderId, truckId });
      if (!result.ok) {
        toast({
          title: t("assignFailedToast"),
          description: result.messageKey ? tRoot(result.messageKey as never) : result.message,
          variant: "destructive",
        });
      }
      refetch();
    });
  };

  const depart = (truckId: string) => {
    startTransition(async () => {
      const result = await departTruck(organizationSlug, { truckId, date });
      if (!result.ok) {
        toast({
          title: t("departFailedToast"),
          description: result.messageKey ? tRoot(result.messageKey as never) : result.message,
          variant: "destructive",
        });
      } else {
        toast({ title: t("departedToast", { name: truckById.get(truckId)?.name ?? t("truckFallback") }) });
      }
      refetch();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {draft.proposals.length > 0 && !dismissed ? (
        <div className="animate-panel-in flex flex-wrap items-center gap-3 rounded-lg border bg-accent/60 p-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {t("draftReady", { placed: draft.proposals.length, pool: draft.poolCount })}
            </p>
            <p className="text-xs text-muted-foreground">
              {draft.exceptions.length > 0
                ? t("exceptionsNeedDecision", { count: draft.exceptions.length })
                : t("allAssigned")}
            </p>
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => setDismissedFor(date)}>
              {t("dismiss")}
            </Button>
            <Button disabled={isPending} onClick={acceptAll}>
              {isPending && <Loader2 className="animate-spin" />}
              {t("accept", { count: draft.proposals.length })}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <aside className="flex flex-col gap-2">
          {draft.proposals.length > 0 && dismissed ? (
            <Button
              variant="outline"
              className="animate-panel-in w-full border-dashed text-muted-foreground hover:text-foreground"
              onClick={() => setDismissedFor(null)}
            >
              {t("showDraftPlan", { count: draft.proposals.length })}
            </Button>
          ) : null}

          {draft.exceptions.length > 0 ? (
            <>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("needsDecisionHeading", { count: draft.exceptions.length })}
              </h2>
              {draft.exceptions.map((ex) => {
                const o = orderById.get(ex.orderId);
                return (
                  <div key={ex.orderId} className="flex flex-col gap-2 rounded-lg border border-l-4 border-l-amber-500 bg-card p-3">
                    <p className="text-sm font-medium">{o?.customer?.name ?? t("orderFallback")}</p>
                    <p className="text-xs text-muted-foreground">{t(ex.detailKey)}</p>
                    {(ex.kind === "no_covering_truck" || ex.kind === "all_trucks_full") && (
                      <select
                        className="min-h-8 rounded-md border bg-background px-2 text-xs transition-[color,box-shadow] duration-200 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50"
                        defaultValue=""
                        disabled={isPending}
                        onChange={(e) => {
                          if (e.target.value) overrideAssign(ex.orderId, e.target.value);
                        }}
                      >
                        <option value="" disabled>
                          {t("overrideOnto")}
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
            {t("proposedHeading", { count: draft.proposals.length })}
          </h2>
          {draft.proposals.map((p) => {
            const o = orderById.get(p.orderId);
            return (
              <div key={p.orderId} className="rounded-lg border border-l-4 border-l-primary bg-card p-3">
                <p className="text-sm font-medium">
                  {o?.customer?.name ?? t("orderFallback")} → {truckById.get(p.truckId)?.name ?? t("truckFallback")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {p.slotTime
                    ? t("reason.withSlot", { zone: p.zoneName, slot: p.slotTime })
                    : t("reason.withoutSlot", { zone: p.zoneName })}
                </p>
              </div>
            );
          })}
          {draft.poolCount === 0 ? (
            <div className="rounded-lg border border-dashed p-3">
              <p className="text-sm font-medium">
                {data.orders.length === 0 ? t("emptyTitleNoOrders") : t("emptyTitleAllAssigned")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.orders.length === 0 ? t("emptyBodyNoOrders") : t("emptyBodyAllAssigned")}
              </p>
            </div>
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
            <p className="text-sm text-muted-foreground">{t("noActiveTrucks")}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
