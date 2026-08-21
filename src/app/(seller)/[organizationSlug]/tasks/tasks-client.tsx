"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { completeTask } from "@/features/orders/server/order-actions";
import type { TaskWithOrder } from "@/features/orders/types";
import {
  buildCompletePayload,
  createWeighState,
  firstReadyUnsubmittedTaskId,
  weighReducer,
} from "@/features/orders/lib/weigh-model";
import { WeighStation } from "@/features/orders/components/weigh-station";
import { SwipeDeck } from "@/features/orders/components/swipe-deck";
import { useToast } from "@/hooks/use-toast";

type TasksClientProps = {
  organizationSlug: string;
  initialTasks: TaskWithOrder[];
  /** Open straight on this order — set by "Weigh now" links from Loading. */
  focusOrderId?: string;
};

/**
 * Warehouse tasks: one shared weigh model rendered as two experiences —
 * a kiosk "weigh station" on md+ screens and a gesture-driven card deck on
 * mobile. Orders submit automatically once their last line has a weight.
 */
export function TasksClient({ organizationSlug, initialTasks, focusOrderId }: TasksClientProps) {
  const { toast } = useToast();
  const [state, dispatch] = useReducer(weighReducer, { initialTasks, focusOrderId }, (init) =>
    createWeighState(init.initialTasks, init.focusOrderId),
  );
  // Tasks with an in-flight completeTask call (also mirrored in state.pendingRemovals).
  const pendingRef = useRef<Set<string>>(new Set());
  const syncingTaskIds = new Set(Object.keys(state.pendingRemovals));

  useEffect(() => {
    const taskId = firstReadyUnsubmittedTaskId(state, pendingRef.current);
    if (!taskId) return;
    const weights = buildCompletePayload(state.queue, state.drafts, taskId);
    pendingRef.current.add(taskId);
    dispatch({ type: "OPTIMISTIC_COMPLETE", taskId });
    void completeTask({ organizationSlug, taskId, weights }).then((result) => {
      pendingRef.current.delete(taskId);
      if (!result.ok) {
        dispatch({ type: "RESTORE_TASK", taskId });
        toast({ title: "Couldn't save order", description: result.message, variant: "destructive" });
        return;
      }
      toast({ title: "Order complete" });
    });
  }, [state, organizationSlug, toast]);

  // Physical keyboard entry for the kiosk (md+ only, checked at event time).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!window.matchMedia("(min-width: 768px)").matches) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (/^[0-9]$/.test(event.key)) {
        dispatch({ type: "DIGIT", digit: event.key });
      } else if (event.key === "." || event.key === ",") {
        dispatch({ type: "DOT" });
      } else if (event.key === "Backspace") {
        dispatch({ type: "BACKSPACE" });
      } else if (event.key === "Enter") {
        dispatch({ type: "NEXT" });
      } else if (event.key.toLowerCase() === "p") {
        dispatch({ type: "TOGGLE_TARGET" });
      } else {
        return;
      }
      event.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex h-[calc(100svh-4rem-1.5rem)] flex-col gap-4 md:h-[calc(100svh-4rem-2rem)]">
      <WeighStation
        state={state}
        dispatch={dispatch}
        syncingTaskIds={syncingTaskIds}
        className="hidden md:flex"
      />
      <SwipeDeck state={state} dispatch={dispatch} className="flex md:hidden" />
    </div>
  );
}
