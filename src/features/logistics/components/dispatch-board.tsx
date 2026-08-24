"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
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

function PoolColumn({ tickets }: { tickets: DispatchTicket[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: "pool" });
  const t = useTranslations("logistics.dispatch");
  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col gap-2 rounded-lg border p-3 transition-colors duration-150 motion-reduce:transition-none ${
        isOver ? "border-primary/50 bg-accent" : "bg-muted/30"
      }`}
    >
      <h2 className="text-sm font-semibold">{t("pool.title")}</h2>
      {tickets.map((ticket) => (
        <TicketCard key={ticket.id} ticket={ticket} />
      ))}
      {tickets.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("pool.empty")}</p>
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
  const t = useTranslations("logistics.dispatch");
  const tCommon = useTranslations("common");
  const tLogistics = useTranslations("logistics");
  const tRoot = useTranslations();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const view = useMemo(() => buildBoardView(data, date), [data, date]);
  const compatible = useMemo(
    () => (activeTicket ? compatibleTruckIds(activeTicket, data) : null),
    [activeTicket, data],
  );

  const showToast = useCallback(
    (message: string, title = tLogistics("error")) => {
      toast({ title, description: message, variant: "destructive" });
    },
    [toast, tLogistics],
  );

  const runAction = (action: Promise<{ ok: boolean; message?: string; messageKey?: string }>) => {
    startTransition(async () => {
      const result = await action;
      if (!result.ok) {
        showToast(
          result.messageKey ? tRoot(result.messageKey as never) : (result.message ?? tLogistics("actionFailed")),
        );
      }
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
      const boardTruck = view.bays.flatMap((b) => b.trucks).find((bt) => bt.truck.id === truckId);
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
      showToast(t(`blocked.${resolution.reasonKey}` as never), t("moveNotAllowed"));
      return;
    }
    if (resolution.kind === "unassign") {
      runAction(unassignOrder(organizationSlug, { orderId: ticket.id }));
      return;
    }
    if (resolution.kind === "override") {
      const truck = data.trucks.find((tr) => tr.id === resolution.truckId);
      setOverride({
        orderId: ticket.id,
        truckId: resolution.truckId,
        truckName: truck?.name ?? t("override.fallbackTruckName"),
      });
      return;
    }
    runAction(assignOrder(organizationSlug, { orderId: ticket.id, truckId: resolution.truckId }));
  };

  const requestDepart = (truckId: string) => {
    const boardTruck = view.bays.flatMap((b) => b.trucks).find((bt) => bt.truck.id === truckId);
    if (!boardTruck) return;
    const notReady = boardTruck.tickets.filter((tk) => tk.status !== "ready").length;
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
        showToast(result.messageKey ? tRoot(result.messageKey as never) : result.message);
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
                  canDepart={!bt.departed && bt.tickets.some((tk) => tk.status === "ready")}
                />
              ))}
              {trucks.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("bay.empty")}</p>
              ) : null}
            </div>
          ))}
        </div>
        <DragOverlay>
          {activeTicket ? (
            <div className="rotate-2 opacity-90">
              <TicketCard ticket={activeTicket} overlay />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <Dialog open={override !== null} onOpenChange={(open) => !open && setOverride(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("override.title")}</DialogTitle>
            <DialogDescription>
              {override ? t("override.body", { truckName: override.truckName }) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverride(null)}>
              {tCommon("cancel")}
            </Button>
            <Button
              onClick={() => {
                if (!override) return;
                runAction(assignOrder(organizationSlug, { orderId: override.orderId, truckId: override.truckId }));
                setOverride(null);
              }}
            >
              {t("override.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={departConfirm !== null} onOpenChange={(open) => !open && setDepartConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {departConfirm ? t("departConfirm.title", { count: departConfirm.notReady }) : null}
            </DialogTitle>
            <DialogDescription>{t("departConfirm.body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDepartConfirm(null)}>
              {tCommon("cancel")}
            </Button>
            <Button onClick={() => departConfirm && doDepart(departConfirm.truckId)}>
              {t("departConfirm.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
