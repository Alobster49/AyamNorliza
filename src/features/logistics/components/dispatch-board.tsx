"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { DispatchBoardData, DispatchTicket } from "../types";
import { buildBoardView, compatibleTruckIds } from "../lib/dispatch-board-model";
import { resolveDispatchDrop, type DispatchDropTarget } from "../lib/dispatch-rules";
import { assignOrder, departTruck, unassignOrder } from "../server/dispatch-actions";
import { TicketCard } from "./ticket-card";
import { TruckCard } from "./truck-card";
import { useToast } from "@/hooks/use-toast";

function PoolColumn({ tickets }: { tickets: DispatchTicket[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: "pool" });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col gap-2 rounded-lg border p-3 ${isOver ? "bg-accent" : "bg-muted/30"}`}
    >
      <h2 className="text-sm font-semibold">Order pool</h2>
      {tickets.map((t) => (
        <TicketCard key={t.id} ticket={t} />
      ))}
      {tickets.length === 0 ? (
        <p className="text-xs text-muted-foreground">No unassigned orders for this date.</p>
      ) : null}
    </div>
  );
}

export function DispatchBoard({
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
  const [activeTicket, setActiveTicket] = useState<DispatchTicket | null>(null);
  const { toast } = useToast();
  const [override, setOverride] = useState<{ orderId: string; truckId: string; truckName: string } | null>(null);
  const [departConfirm, setDepartConfirm] = useState<{ truckId: string; notReady: number } | null>(null);
  const [departingTruckId, setDepartingTruckId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const view = useMemo(() => buildBoardView(data, date), [data, date]);
  const compatible = useMemo(
    () => (activeTicket ? compatibleTruckIds(activeTicket, data) : null),
    [activeTicket, data],
  );

  const showToast = useCallback(
    (message: string, title = "Error") => {
      toast({ title, description: message, variant: "destructive" });
    },
    [toast],
  );

  const runAction = (action: Promise<{ ok: boolean; message?: string }>) => {
    startTransition(async () => {
      const result = await action;
      if (!result.ok) showToast(result.message ?? "Action failed");
      refetch();
    });
  };

  const handleDragStart = (event: DragStartEvent) => {
    const ticket = data.orders.find((o) => o.id === event.active.id);
    setActiveTicket(ticket ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const ticket = activeTicket;
    setActiveTicket(null);
    if (!ticket || !event.over) return;

    const overId = String(event.over.id);
    let target: DispatchDropTarget;
    if (overId === "pool") {
      target = { type: "pool" };
    } else if (overId.startsWith("truck:")) {
      const truckId = overId.slice("truck:".length);
      const boardTruck = view.bays.flatMap((b) => b.trucks).find((t) => t.truck.id === truckId);
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
    if (resolution.kind === "blocked") {
      showToast(resolution.reason, "Move not allowed");
      return;
    }
    if (resolution.kind === "unassign") {
      runAction(unassignOrder(organizationSlug, { orderId: ticket.id }));
      return;
    }
    if (resolution.kind === "override") {
      const truck = data.trucks.find((t) => t.id === resolution.truckId);
      setOverride({ orderId: ticket.id, truckId: resolution.truckId, truckName: truck?.name ?? "this truck" });
      return;
    }
    runAction(assignOrder(organizationSlug, { orderId: ticket.id, truckId: resolution.truckId }));
  };

  const requestDepart = (truckId: string) => {
    const boardTruck = view.bays.flatMap((b) => b.trucks).find((t) => t.truck.id === truckId);
    if (!boardTruck) return;
    const notReady = boardTruck.tickets.filter((t) => t.status !== "ready").length;
    if (notReady > 0) {
      setDepartConfirm({ truckId, notReady });
    } else {
      doDepart(truckId);
    }
  };

  const doDepart = (truckId: string) => {
    setDepartConfirm(null);
    setDepartingTruckId(truckId);
    startTransition(async () => {
      const result = await departTruck(organizationSlug, { truckId, date });
      if (!result.ok) {
        setDepartingTruckId(null);
        showToast(result.message);
        return;
      }
      // Let the slide-out animation play before the board re-renders the
      // truck as departed. Matches the 300ms transition on TruckCard. Skip
      // the delay entirely when the user prefers reduced motion.
      const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 350;
      setTimeout(() => {
        setDepartingTruckId(null);
        refetch();
      }, delay);
    });
  };

  return (
    <>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex items-start gap-4 overflow-x-auto pb-4">
          <PoolColumn tickets={view.pool} />
          {view.bays.map(({ bay, trucks }) => (
            <div key={bay.id} className="flex w-80 shrink-0 flex-col gap-3 rounded-lg border bg-muted/20 p-3">
              <h2 className="text-sm font-semibold">{bay.name}</h2>
              {trucks.map((bt) => (
                <TruckCard
                  key={bt.truck.id}
                  boardTruck={bt}
                  highlight={compatible !== null && compatible.has(bt.truck.id) && !bt.departed}
                  dim={compatible !== null && !compatible.has(bt.truck.id)}
                  departing={departingTruckId === bt.truck.id}
                  onDepart={() => requestDepart(bt.truck.id)}
                  canDepart={!bt.departed && bt.tickets.some((t) => t.status === "ready")}
                />
              ))}
              {trucks.length === 0 ? (
                <p className="text-xs text-muted-foreground">No trucks in this bay.</p>
              ) : null}
            </div>
          ))}
        </div>
        <DragOverlay>{activeTicket ? <TicketCard ticket={activeTicket} overlay /> : null}</DragOverlay>
      </DndContext>

      {override ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-96 rounded-lg bg-background p-4 shadow-xl">
            <h3 className="font-semibold">Override coverage?</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {override.truckName} does not cover this order&apos;s zone. Assign anyway?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={() => setOverride(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                onClick={() => {
                  runAction(assignOrder(organizationSlug, { orderId: override.orderId, truckId: override.truckId }));
                  setOverride(null);
                }}
              >
                Override
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {departConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-96 rounded-lg bg-background p-4 shadow-xl">
            <h3 className="font-semibold">Depart without {departConfirm.notReady} unready order{departConfirm.notReady === 1 ? "" : "s"}?</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Orders that are not ready stay behind and return to the pool for a later run.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={() => setDepartConfirm(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                onClick={() => doDepart(departConfirm.truckId)}
              >
                Depart
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
