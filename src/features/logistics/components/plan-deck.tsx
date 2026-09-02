"use client";

import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { DispatchBoardData, DispatchTicket } from "../types";
import {
  buildBoardView,
  compatibleTruckIds,
  hasUnloadedReadyTickets,
  type BoardTruck,
} from "../lib/dispatch-board-model";
import {
  draftPlan,
  orderWeightKg,
  projectLoad,
  totalWeightKg,
  type LoadProjection,
  type PlanDraft,
} from "../lib/plan-model";
import { resolveDispatchDrop, type DispatchDropTarget } from "../lib/dispatch-rules";
import type { TruckDuty } from "../lib/roster-model";
import { applyPlan, assignOrder, departTruck, unassignOrder } from "../server/dispatch-actions";
import { DriverLine } from "./truck-card";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

// Lint-clean mount detection (no setState-in-effect): server snapshot false,
// client snapshot true.
const emptySubscribe = () => () => {};
const useMounted = () => useSyncExternalStore(emptySubscribe, () => true, () => false);

/** Load against truck capacity. Same animated dial as the runs board. */
function Dial({ pct, tone, label }: { pct: number; tone?: "ok" | "warn" | "over"; label: string }) {
  const clamped = Math.min(Math.max(pct, 0), 100);
  const color =
    tone === "over" || (tone === undefined && pct > 100)
      ? "var(--destructive)"
      : tone === "warn" || (tone === undefined && pct >= 90)
        ? "var(--color-warning)"
        : "var(--primary)";
  return (
    <div
      className="run-dial grid size-12 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums"
      style={
        {
          "--dial-pct": `${clamped}%`,
          background: `conic-gradient(${color} var(--dial-pct), var(--muted) var(--dial-pct) 100%)`,
        } as CSSProperties
      }
      role="img"
      aria-label={label}
    >
      <span className="grid size-9 place-items-center rounded-full bg-card">{Math.round(pct)}%</span>
    </div>
  );
}

/**
 * Sidebar ticket. The whole card is the drag handle; on phones the sidebar
 * lays these out as a horizontal rail, so cards keep a fixed width below lg.
 */
function PlanTicket({
  ticket,
  disabled,
  accent,
  overlay = false,
  children,
}: {
  ticket: DispatchTicket;
  disabled: boolean;
  accent: "proposal" | "exception";
  /**
   * Rendered inside DragOverlay: same markup and size as the rack card, so
   * picking a ticket up causes zero visual jump and the cursor stays exactly
   * on the point that was grabbed.
   */
  overlay?: boolean;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: overlay ? `overlay:${ticket.id}` : ticket.id,
    disabled: disabled || overlay,
  });
  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      {...(overlay ? {} : { ...attributes, ...listeners })}
      className={[
        "flex flex-col gap-2 rounded-lg border border-l-4 bg-card p-3",
        overlay ? "h-full w-full cursor-grabbing shadow-xl ring-1 ring-ring/20" : "w-64 shrink-0 snap-start lg:w-auto",
        accent === "proposal" ? "border-l-primary" : "border-l-amber-500",
        disabled && !overlay ? "opacity-60" : overlay ? "" : "cursor-grab active:cursor-grabbing",
        // The rack keeps a dashed slot where the ticket came from, so the
        // origin stays visible while the overlay travels.
        isDragging && !overlay ? "border-dashed opacity-30" : "",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function TicketWeight({ ticket }: { ticket: DispatchTicket }) {
  const t = useTranslations("logistics.dispatch.plan");
  const kg = orderWeightKg(ticket);
  return (
    <span className="ml-auto shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
      {kg !== null ? t("weightOnly", { kg: kg.toFixed(1) }) : "—"}
    </span>
  );
}

/**
 * The rack card and the drag overlay render these same bodies, so the card
 * under the cursor is pixel-identical to the one that was picked up.
 */
function ProposalTicketBody({ ticket, reason }: { ticket: DispatchTicket; reason: string }) {
  const t = useTranslations("logistics.dispatch.plan");
  return (
    <>
      <div className="flex items-center gap-2">
        <p className="min-w-0 truncate text-sm font-medium">{ticket.customer?.name ?? t("orderFallback")}</p>
        <TicketWeight ticket={ticket} />
      </div>
      <p className="text-xs text-muted-foreground">{reason}</p>
    </>
  );
}

function ExceptionTicketBody({
  ticket,
  detailKey,
  showSelect,
  trucks,
  disabled,
  onAssign,
}: {
  ticket: DispatchTicket;
  detailKey: string;
  showSelect: boolean;
  trucks: BoardTruck[];
  disabled: boolean;
  onAssign?: (truckId: string) => void;
}) {
  const t = useTranslations("logistics.dispatch.plan");
  return (
    <>
      <div className="flex items-center gap-2">
        <p className="min-w-0 truncate text-sm font-medium">{ticket.customer?.name ?? t("orderFallback")}</p>
        <TicketWeight ticket={ticket} />
      </div>
      <p className="text-xs text-muted-foreground">{t(detailKey as never)}</p>
      {showSelect && (
        <select
          className="min-h-8 rounded-md border bg-background px-2 text-xs transition-[color,box-shadow] duration-200 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50"
          defaultValue=""
          disabled={disabled || !onAssign}
          onChange={(e) => {
            if (e.target.value && onAssign) onAssign(e.target.value);
          }}
        >
          <option value="" disabled>
            {t("overrideOnto")}
          </option>
          {trucks
            .filter((bt) => !bt.departed)
            .map((bt) => (
              <option key={bt.truck.id} value={bt.truck.id}>
                {bt.truck.name} ({bt.truck.code})
              </option>
            ))}
        </select>
      )}
    </>
  );
}

function GhostLine({ proj }: { proj: LoadProjection }) {
  const t = useTranslations("logistics.dispatch.plan");
  const toneClass =
    proj.tone === "over"
      ? "border-destructive text-destructive"
      : proj.tone === "warn"
        ? "border-amber-500 text-amber-700 dark:text-amber-400"
        : "border-green-600/60 text-green-700 dark:text-green-400";
  return (
    <p className={`rounded-md border border-dashed px-2 py-1 text-center text-xs tabular-nums ${toneClass}`}>
      {proj.addKg === null
        ? t("ghostNoWeight")
        : proj.pct === null
          ? t("ghostNoCap", { kg: proj.addKg.toFixed(1) })
          : t("ghostProjected", { kg: proj.addKg.toFixed(1), pct: Math.round(proj.pct) })}
    </p>
  );
}

/**
 * One order on a truck's manifest. While the truck is still here and the
 * order isn't loaded, the row can be dragged out (to the rack or another
 * truck) or removed with the X, which sends it back to the proposed rack.
 */
function ManifestRow({
  tk,
  truckName,
  removable,
  pending,
  onRemove,
}: {
  tk: DispatchTicket;
  truckName: string;
  removable: boolean;
  pending: boolean;
  onRemove: () => void;
}) {
  const t = useTranslations("logistics.dispatch.plan");
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: tk.id,
    disabled: !removable || pending,
  });
  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={[
        "group/row flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1 text-xs",
        removable && !pending ? "cursor-grab active:cursor-grabbing" : "",
        isDragging ? "opacity-30" : "",
        pending ? "opacity-50" : "",
      ].join(" ")}
    >
      <span className="min-w-0 truncate">{tk.customer?.name ?? t("orderFallback")}</span>
      {tk.loaded_at ? (
        <span className="shrink-0 text-green-700 dark:text-green-400">{t("loaded")}</span>
      ) : null}
      <span className="ml-auto shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">
        {orderWeightKg(tk) !== null ? `${orderWeightKg(tk)!.toFixed(1)} kg` : "—"}
      </span>
      {pending ? (
        <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
      ) : removable ? (
        <button
          type="button"
          aria-label={t("removeFromTruck", { truckName })}
          title={t("removeFromTruck", { truckName })}
          className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground transition-opacity duration-150 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none lg:opacity-0 lg:group-hover/row:opacity-100"
          // Stop the press from reaching the row's drag listeners, so the X
          // is a click, never the start of a drag.
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onClick={onRemove}
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </li>
  );
}

/**
 * The whole rack is a drop target while a truck-assigned ticket is being
 * dragged: dropping it here unassigns back to proposed.
 */
function RackDropZone({ active, children }: { active: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: "pool", disabled: !active });
  const t = useTranslations("logistics.dispatch.plan");
  return (
    <aside
      ref={setNodeRef}
      className={[
        "flex min-h-0 flex-col gap-2 rounded-lg transition-all duration-150 motion-reduce:transition-none lg:overflow-y-auto lg:overscroll-y-contain lg:pr-1",
        active && !isOver ? "outline outline-1 outline-dashed outline-offset-4 outline-green-600/50" : "",
        active && isOver ? "bg-green-500/5 outline outline-2 outline-dashed outline-offset-4 outline-green-600" : "",
      ].join(" ")}
    >
      {active ? (
        <p className="rounded-md border border-dashed border-green-600/60 px-2 py-1 text-center text-xs text-green-700 dark:text-green-400">
          {t("dropToUnassign")}
        </p>
      ) : null}
      {children}
    </aside>
  );
}

function TruckPlanCard({
  bt,
  duty,
  incoming,
  activeTicket,
  compatible,
  pendingTickets,
  pendingMoves,
  pendingUnassign,
  onRemove,
  onDepart,
  departPending,
}: {
  bt: BoardTruck;
  /** Who drives it that day — null-driver trucks warn before they get planned. */
  duty: TruckDuty | null;
  incoming: number;
  /** The ticket being dragged, if any — drives the invite/dim/ghost states. */
  activeTicket: DispatchTicket | null;
  /** null when nothing is dragging; otherwise whether this truck covers the ticket's zone. */
  compatible: boolean | null;
  /** Optimistic: tickets dropped here whose assign is still in flight. */
  pendingTickets: DispatchTicket[];
  /** Optimistic: every in-flight assign (orderId -> target truck), to hide rows moving away. */
  pendingMoves: Map<string, string>;
  /** Optimistic: orders being sent back to the proposed rack. */
  pendingUnassign: Set<string>;
  onRemove: (orderId: string) => void;
  onDepart: () => void;
  departPending: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const t = useTranslations("logistics.dispatch.plan");
  const tCommon = useTranslations("common");
  const { setNodeRef, isOver } = useDroppable({ id: `truck:${bt.truck.id}`, disabled: bt.departed });
  // A ticket mid-move to another truck disappears from this manifest right
  // away — it is already showing as a pending row on the target truck.
  const rows = bt.tickets.filter((tk) => (pendingMoves.get(tk.id) ?? bt.truck.id) === bt.truck.id);
  // Weight, dial and manifest count the in-flight drops too, so a drop lands
  // visually the instant it happens instead of after the server round-trip.
  const shownTickets = [...rows, ...pendingTickets];
  const kg = totalWeightKg(shownTickets);
  const load = rows.length + pendingTickets.length;
  const notReady = bt.tickets.filter((tk) => tk.status !== "ready").length;
  const readyCount = bt.tickets.filter((tk) => tk.status === "ready").length;
  // A 'ready' ticket the loading screen never signed off blocks departure
  // server-side (dispatch_depart_truck raises 'not_loaded') -- disable the
  // button up front rather than let the click round-trip into that error.
  const unloadedReady = hasUnloadedReadyTickets(bt.tickets);
  const pct =
    bt.truck.capacity_kg !== null && bt.truck.capacity_kg > 0
      ? (kg / bt.truck.capacity_kg) * 100
      : bt.cap !== null && bt.cap > 0
        ? (load / bt.cap) * 100
        : 0;

  const dragging = activeTicket !== null && !bt.departed;
  const proj =
    dragging && isOver ? projectLoad(activeTicket, { tickets: shownTickets, truck: bt.truck }) : null;
  // While hovering, the dial previews the post-drop load instead of the
  // current one — the dispatcher sees the consequence before committing.
  const dialPct = proj !== null && proj.pct !== null ? proj.pct : pct;

  return (
    <article
      ref={setNodeRef}
      className={[
        "flex h-full flex-col gap-3 rounded-lg border bg-card p-3 transition-all duration-150 motion-reduce:transition-none",
        bt.departed ? "border-dashed opacity-70" : "",
        dragging && compatible === true && !isOver ? "border-dashed border-green-600/70 bg-green-500/5" : "",
        dragging && compatible === true && isOver
          ? "scale-[1.01] border-green-600 shadow-lg ring-2 ring-green-500/30"
          : "",
        dragging && compatible === false && !isOver ? "opacity-40" : "",
        dragging && compatible === false && isOver ? "border-amber-500 ring-2 ring-amber-500/20" : "",
      ].join(" ")}
    >
      <div className="flex items-center gap-3">
        <Dial pct={dialPct} tone={proj?.tone} label={t("loadLabel", { name: bt.truck.name })} />
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
            {t("orderCount", { load, capSuffix: bt.cap !== null ? `/${bt.cap}` : "" })}
            {incoming > 0 ? ` · ${t("proposedSuffix", { count: incoming })}` : ""}
          </p>
          <DriverLine duty={duty} className="mt-0.5" />
        </div>
      </div>

      <ul className="flex flex-col gap-1">
        {rows.slice(0, 5).map((tk) => (
          <ManifestRow
            key={tk.id}
            tk={tk}
            truckName={bt.truck.name}
            // Movable until the truck departs or the loading screen signs the
            // order off — after either, the physical goods are committed.
            removable={!bt.departed && tk.loaded_at === null}
            pending={pendingUnassign.has(tk.id)}
            onRemove={() => onRemove(tk.id)}
          />
        ))}
        {rows.length > 5 ? (
          <li className="px-2 text-xs text-muted-foreground">{t("more", { count: rows.length - 5 })}</li>
        ) : null}
        {pendingTickets.map((tk) => (
          <li
            key={tk.id}
            className="animate-panel-in flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1 text-xs opacity-70"
          >
            <span className="min-w-0 truncate">{tk.customer?.name ?? t("orderFallback")}</span>
            <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
            <span className="ml-auto shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">
              {orderWeightKg(tk) !== null ? `${orderWeightKg(tk)!.toFixed(1)} kg` : "—"}
            </span>
          </li>
        ))}
        {shownTickets.length === 0 ? (
          <li className="px-2 text-xs text-muted-foreground">{t("noOrdersYet")}</li>
        ) : null}
      </ul>

      {proj !== null ? (
        <GhostLine proj={proj} />
      ) : dragging && compatible === true ? (
        <p className="rounded-md border border-dashed border-green-600/60 px-2 py-1 text-center text-xs text-green-700 dark:text-green-400">
          {t("dropToAssign")}
        </p>
      ) : null}

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
            disabled={departPending || readyCount === 0 || unloadedReady}
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
  const mounted = useMounted();
  const t = useTranslations("logistics.dispatch.plan");
  const tDispatch = useTranslations("logistics.dispatch");
  const tCommon = useTranslations("common");
  const tRoot = useTranslations();
  // Dismissal belongs to the date it was made on. Plain boolean state would
  // survive a date change and silently hide the next day's draft, with a page
  // reload as the only way back.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const dismissed = dismissedFor === date;

  const [activeTicket, setActiveTicket] = useState<DispatchTicket | null>(null);
  const [override, setOverride] = useState<{ orderId: string; truckId: string; truckName: string } | null>(null);
  const [overweight, setOverweight] = useState<{
    orderId: string;
    truckId: string;
    truckName: string;
    pct: number;
    capacity: number;
  } | null>(null);
  // Optimistic assigns in flight: orderId -> truckId. The rack hides these
  // tickets and the target truck shows them immediately; the next data load
  // (or a failed assign) reconciles.
  const [pendingAssign, setPendingAssign] = useState<Map<string, string>>(new Map());
  // Optimistic unassigns in flight: the manifest row dims with a spinner
  // until the refetch puts the ticket back in the rack.
  const [pendingUnassign, setPendingUnassign] = useState<Set<string>>(new Set());
  // Whether the overlay animates back to the rack on release. True for a
  // cancelled or blocked drag (the ticket really does go home); false for a
  // drop that landed, where flying back would contradict what just happened.
  const [returnOverlay, setReturnOverlay] = useState(true);

  // Reset the optimistic map whenever fresh board data arrives (the
  // adjust-state-during-render idiom, not an effect).
  const [lastData, setLastData] = useState(data);
  if (lastData !== data) {
    setLastData(data);
    setPendingAssign(new Map());
    setPendingUnassign(new Set());
  }

  // The overlay ignores pointer events, so without this the page under it
  // decides the cursor and the grab feeling flickers away mid-drag.
  useEffect(() => {
    if (!activeTicket) return;
    document.body.classList.add("cursor-grabbing");
    return () => document.body.classList.remove("cursor-grabbing");
  }, [activeTicket]);

  // MouseSensor for pointer precision on desktop; TouchSensor with a hold
  // delay so phone and tablet users can still scroll the ticket rail with a
  // swipe — a 250ms press turns into a drag instead.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const view = useMemo(() => buildBoardView(data, date), [data, date]);
  const draft: PlanDraft = useMemo(() => draftPlan(data, date), [data, date]);
  const orderById = useMemo(() => new Map(data.orders.map((o) => [o.id, o])), [data.orders]);
  const truckById = useMemo(() => new Map(data.trucks.map((t) => [t.id, t])), [data.trucks]);
  const incomingByTruck = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of draft.proposals) m.set(p.truckId, (m.get(p.truckId) ?? 0) + 1);
    return m;
  }, [draft.proposals]);
  const compatible = useMemo(
    () => (activeTicket ? compatibleTruckIds(activeTicket, data) : null),
    [activeTicket, data],
  );

  const boardTrucks = view.bays.flatMap((b) => b.trucks);

  const pendingByTruck = useMemo(() => {
    const m = new Map<string, DispatchTicket[]>();
    for (const [orderId, truckId] of pendingAssign) {
      const o = orderById.get(orderId);
      if (o) m.set(truckId, [...(m.get(truckId) ?? []), o]);
    }
    return m;
  }, [pendingAssign, orderById]);

  const acceptAll = () => {
    setPendingAssign(new Map(draft.proposals.map((p) => [p.orderId, p.truckId])));
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

  const assign = (orderId: string, truckId: string) => {
    setPendingAssign((prev) => new Map(prev).set(orderId, truckId));
    startTransition(async () => {
      const result = await assignOrder(organizationSlug, { orderId, truckId });
      if (!result.ok) {
        setPendingAssign((prev) => {
          const m = new Map(prev);
          m.delete(orderId);
          return m;
        });
        toast({
          title: t("assignFailedToast"),
          description: result.messageKey ? tRoot(result.messageKey as never) : result.message,
          variant: "destructive",
        });
      }
      refetch();
    });
  };

  const unassign = (orderId: string) => {
    setPendingUnassign((prev) => new Set(prev).add(orderId));
    startTransition(async () => {
      const result = await unassignOrder(organizationSlug, { orderId });
      if (!result.ok) {
        setPendingUnassign((prev) => {
          const s = new Set(prev);
          s.delete(orderId);
          return s;
        });
        toast({
          title: t("unassignFailedToast"),
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

  const handleDragStart = (event: DragStartEvent) => {
    setReturnOverlay(true);
    setActiveTicket(orderById.get(String(event.active.id)) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const ticket = activeTicket;
    setActiveTicket(null);
    if (!ticket || !event.over) return;

    const overId = String(event.over.id);
    let target: DispatchDropTarget;
    let boardTruck: BoardTruck | null = null;
    if (overId === "pool") {
      target = { type: "pool" };
    } else if (overId.startsWith("truck:")) {
      const truckId = overId.slice("truck:".length);
      boardTruck = boardTrucks.find((bt) => bt.truck.id === truckId) ?? null;
      if (!boardTruck) return;
      target = {
        type: "truck",
        truckId,
        compatible: compatible?.has(truckId) ?? false,
        atCapacity: boardTruck.cap !== null && boardTruck.load >= boardTruck.cap,
        departed: boardTruck.departed,
      };
    } else {
      return;
    }
    const assignedTruckId = ticket.assignment_source === "none" ? null : ticket.truck_id;
    const runStatus = data.runs.find((r) => r.id === ticket.run_id)?.status ?? null;
    const resolution = resolveDispatchDrop(
      { status: ticket.status, assignedTruckId, runStatus },
      target,
    );

    if (resolution.kind === "noop") return;
    if (resolution.kind === "unassign") {
      setReturnOverlay(false);
      unassign(ticket.id);
      return;
    }
    if (resolution.kind === "blocked") {
      toast({
        title: tDispatch("moveNotAllowed"),
        description: tDispatch(`blocked.${resolution.reasonKey}` as never),
        variant: "destructive",
      });
      return;
    }
    const truckName = truckById.get(resolution.truckId)?.name ?? tDispatch("override.fallbackTruckName");
    if (resolution.kind === "override") {
      setOverride({ orderId: ticket.id, truckId: resolution.truckId, truckName });
      return;
    }
    // Compatible drop, but check the weight consequence before committing:
    // past 100% of capacity the assign needs an explicit yes. An "assign"
    // resolution only comes out of the truck branch, so boardTruck is set.
    if (!boardTruck) return;
    const proj = projectLoad(ticket, boardTruck);
    if (proj.tone === "over" && boardTruck.truck.capacity_kg !== null) {
      setOverweight({
        orderId: ticket.id,
        truckId: resolution.truckId,
        truckName,
        pct: Math.round(proj.pct!),
        capacity: boardTruck.truck.capacity_kg,
      });
      return;
    }
    // The drop landed: kill the fly-back animation and let the optimistic
    // manifest row appear right where the card was released.
    setReturnOverlay(false);
    assign(ticket.id, resolution.truckId);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
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

      {/* Stable id keeps dnd-kit's generated aria ids identical between server
          and client render — PlanDeck is the SSR'd default view, and the
          auto-incremented default id hydration-mismatches. */}
      <DndContext id="dispatch-plan-dnd" sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-4 lg:grid-cols-[300px_1fr] lg:grid-rows-[minmax(0,1fr)]">
          <RackDropZone
            active={activeTicket !== null && activeTicket.assignment_source !== "none"}
          >
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
                {/* Below lg the ticket lists become horizontal snap rails so
                    the trucks stay in reach while dragging on a phone. */}
                <div className="flex snap-x gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
                  {draft.exceptions.map((ex) => {
                    const o = orderById.get(ex.orderId);
                    if (!o || pendingAssign.has(ex.orderId)) return null;
                    return (
                      <PlanTicket key={ex.orderId} ticket={o} disabled={isPending} accent="exception">
                        <ExceptionTicketBody
                          ticket={o}
                          detailKey={ex.detailKey}
                          showSelect={ex.kind === "no_covering_truck" || ex.kind === "all_trucks_full"}
                          trucks={boardTrucks}
                          disabled={isPending}
                          onAssign={(truckId) => assign(ex.orderId, truckId)}
                        />
                      </PlanTicket>
                    );
                  })}
                </div>
              </>
            ) : null}

            <h2 className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("proposedHeading", { count: draft.proposals.length })}
            </h2>
            <div className="flex snap-x gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
              {draft.proposals.map((p) => {
                const o = orderById.get(p.orderId);
                if (!o || pendingAssign.has(p.orderId)) return null;
                return (
                  <PlanTicket key={p.orderId} ticket={o} disabled={isPending} accent="proposal">
                    <ProposalTicketBody
                      ticket={o}
                      reason={
                        p.slotTime
                          ? t("reason.withSlot", { zone: p.zoneName, slot: p.slotTime })
                          : t("reason.withoutSlot", { zone: p.zoneName })
                      }
                    />
                  </PlanTicket>
                );
              })}
            </div>
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
          </RackDropZone>

          <div className="grid min-h-0 content-start gap-3 overflow-y-auto overscroll-y-contain pr-1 sm:grid-cols-2 xl:grid-cols-3">
            {boardTrucks.map((bt) => (
              <TruckPlanCard
                key={bt.truck.id}
                bt={bt}
                duty={data.duties[bt.truck.id] ?? null}
                incoming={Math.max(
                  0,
                  (incomingByTruck.get(bt.truck.id) ?? 0) - (pendingByTruck.get(bt.truck.id)?.length ?? 0),
                )}
                activeTicket={activeTicket}
                compatible={compatible === null ? null : compatible.has(bt.truck.id)}
                pendingTickets={pendingByTruck.get(bt.truck.id) ?? []}
                pendingMoves={pendingAssign}
                pendingUnassign={pendingUnassign}
                onRemove={unassign}
                onDepart={() => depart(bt.truck.id)}
                departPending={isPending}
              />
            ))}
            {boardTrucks.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noActiveTrucks")}</p>
            ) : null}
          </div>
        </div>

        {/* Portaled to <body>: the view wrapper animates with a transform,
            which would hijack the overlay's position:fixed and park the card
            a full header-height away from the cursor. */}
        {mounted
          ? createPortal(
              <DragOverlay
                // A cancelled drag flies home; a landed drop disappears in place
                // (the optimistic manifest row takes over).
                dropAnimation={returnOverlay ? { duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" } : null}
              >
          {activeTicket
            ? (() => {
                const ex = draft.exceptions.find((e) => e.orderId === activeTicket.id);
                const p = draft.proposals.find((pr) => pr.orderId === activeTicket.id);
                if (!ex && !p) {
                  // A manifest row picked off a truck: mirror the row's own
                  // compact shape, not the tall rack-card shape.
                  return (
                    <div className="flex h-full w-full cursor-grabbing items-center gap-2 rounded-md border bg-card px-2 py-1 text-xs shadow-xl ring-1 ring-ring/20">
                      <span className="min-w-0 truncate">{activeTicket.customer?.name ?? t("orderFallback")}</span>
                      <span className="ml-auto shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">
                        {orderWeightKg(activeTicket) !== null
                          ? `${orderWeightKg(activeTicket)!.toFixed(1)} kg`
                          : "—"}
                      </span>
                    </div>
                  );
                }
                return (
                  <PlanTicket ticket={activeTicket} disabled={false} accent={ex ? "exception" : "proposal"} overlay>
                    {ex ? (
                      <ExceptionTicketBody
                        ticket={activeTicket}
                        detailKey={ex.detailKey}
                        showSelect={ex.kind === "no_covering_truck" || ex.kind === "all_trucks_full"}
                        trucks={boardTrucks}
                        disabled={false}
                      />
                    ) : (
                      <ProposalTicketBody
                        ticket={activeTicket}
                        reason={
                          p!.slotTime
                            ? t("reason.withSlot", { zone: p!.zoneName, slot: p!.slotTime })
                            : t("reason.withoutSlot", { zone: p!.zoneName })
                        }
                      />
                    )}
                  </PlanTicket>
                );
              })()
            : null}
        </DragOverlay>,
              document.body,
            )
          : null}
      </DndContext>

      <Dialog open={override !== null} onOpenChange={(open) => !open && setOverride(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tDispatch("override.title")}</DialogTitle>
            <DialogDescription>
              {override ? tDispatch("override.body", { truckName: override.truckName }) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverride(null)}>
              {tCommon("cancel")}
            </Button>
            <Button
              onClick={() => {
                if (!override) return;
                assign(override.orderId, override.truckId);
                setOverride(null);
              }}
            >
              {tDispatch("override.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={overweight !== null} onOpenChange={(open) => !open && setOverweight(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {overweight ? t("overweight.title", { truckName: overweight.truckName }) : null}
            </DialogTitle>
            <DialogDescription>
              {overweight
                ? t("overweight.body", { pct: overweight.pct, capacity: overweight.capacity })
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverweight(null)}>
              {tCommon("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!overweight) return;
                assign(overweight.orderId, overweight.truckId);
                setOverweight(null);
              }}
            >
              {t("overweight.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
