"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { claimWeighTask, completeTask, getTodayTasks } from "@/features/orders/server/order-actions";
import type { TaskWithOrder } from "@/features/orders/types";
import {
  buildCompletePayload,
  createWeighState,
  firstReadyUnsubmittedTaskId,
  isTaskBlocked,
  weighReducer,
  type WeighAction,
} from "@/features/orders/lib/weigh-model";
import { WeighStation } from "@/features/orders/components/weigh-station";
import { SwipeDeck } from "@/features/orders/components/swipe-deck";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";

type TasksClientProps = {
  organizationSlug: string;
  orgId: string;
  viewerId: string;
  initialTasks: TaskWithOrder[];
  initialPeople: Record<string, string>;
  /** Open straight on this order — set by "Weigh now" links from Loading. */
  focusOrderId?: string;
};

/**
 * Warehouse tasks: one shared weigh model rendered as two experiences —
 * a kiosk "weigh station" on md+ screens and a gesture-driven card deck on
 * mobile. Orders submit automatically once their last line has a weight.
 */
export function TasksClient({
  organizationSlug,
  orgId,
  viewerId,
  initialTasks,
  initialPeople,
  focusOrderId,
}: TasksClientProps) {
  const { toast } = useToast();
  const t = useTranslations("tasks");
  const [state, dispatch] = useReducer(
    weighReducer,
    { initialTasks, focusOrderId },
    (init) =>
      createWeighState(init.initialTasks, {
        viewerId,
        focusOrderId: init.focusOrderId,
        nowMs: Date.now(),
      }),
  );
  const [people, setPeople] = useState(initialPeople);
  const pendingRef = useRef<Set<string>>(new Set());
  // Latest state for callbacks registered once.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  // Claims expire client-side too: tick once a minute so a stale amber chip
  // unblocks the queue even with no traffic.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // ---- refetch (shared by realtime, claim failures, releases) ----
  const inFlightRef = useRef(0);
  const refetch = useCallback(async () => {
    inFlightRef.current += 1;
    try {
      const result = await getTodayTasks(organizationSlug);
      if (result.ok) {
        dispatch({ type: "SYNC_TASKS", tasks: result.data.tasks, nowMs: Date.now() });
        setPeople(result.data.people);
      }
    } finally {
      inFlightRef.current -= 1;
    }
  }, [organizationSlug]);

  // ---- auto-claim on first digit ----
  // One in-flight/settled claim attempt per task per approach; cleared when
  // the task leaves the queue so a released task can be re-claimed.
  const claimAttemptsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const liveTaskIds = new Set(state.queue.map((line) => line.taskId));
    for (const id of Array.from(claimAttemptsRef.current)) {
      if (!liveTaskIds.has(id) && !state.claims[id]) claimAttemptsRef.current.delete(id);
    }
  }, [state.queue, state.claims]);

  const maybeClaim = useCallback(() => {
    const snapshot = stateRef.current;
    const line = snapshot.queue[snapshot.cursor];
    if (!line) return;
    const taskId = line.taskId;
    const claim = snapshot.claims[taskId];
    if (claim?.by === viewerId) return; // already mine (local or synced)
    // Known-blocked (chip visible): don't fire a doomed RPC per keystroke.
    if (isTaskBlocked(snapshot, taskId, Date.now())) return;
    if (claimAttemptsRef.current.has(taskId)) return;
    claimAttemptsRef.current.add(taskId);
    dispatch({ type: "CLAIM_LOCAL", taskId, by: viewerId, at: new Date().toISOString() });
    void claimWeighTask({ organizationSlug, taskId, claim: true }).then((result) => {
      if (result.ok) return;
      // Always allow a later retry — the block may expire or be released.
      claimAttemptsRef.current.delete(taskId);
      if (result.code === "conflict") {
        dispatch({ type: "CLAIM_REJECTED", taskId, nowMs: Date.now() });
        toast({ title: t("claimLostTitle"), description: result.message, variant: "destructive" });
      } else {
        dispatch({ type: "CLAIM_CLEARED", taskId });
      }
      void refetch();
    });
  }, [organizationSlug, refetch, t, toast, viewerId]);

  // Every numpad/keyboard/swipe path funnels through this dispatch so the
  // first digit (or dot) into a task fires the claim exactly once.
  const dispatchWithClaim = useCallback(
    (action: WeighAction) => {
      if (action.type === "DIGIT" || action.type === "DOT") maybeClaim();
      dispatch(action);
    },
    [maybeClaim],
  );

  const release = useCallback(
    (taskId: string) => {
      dispatch({ type: "CLAIM_CLEARED", taskId });
      claimAttemptsRef.current.delete(taskId);
      void claimWeighTask({ organizationSlug, taskId, claim: false }).then(() => void refetch());
    },
    [organizationSlug, refetch],
  );

  // ---- realtime: other stations' claims and completions land here ----
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`weigh-queue-${orgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_tasks", filter: `organization_id=eq.${orgId}` },
        () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => void refetchRef.current(), 400);
        },
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [orgId]);

  // ---- auto-submit (unchanged except claim cleanup) ----
  useEffect(() => {
    const taskId = firstReadyUnsubmittedTaskId(state, pendingRef.current);
    if (!taskId) return;
    const weights = buildCompletePayload(state.queue, state.drafts, taskId);
    const customerName = state.queue.find((l) => l.taskId === taskId)?.customerName;
    pendingRef.current.add(taskId);
    dispatch({ type: "OPTIMISTIC_COMPLETE", taskId });
    void completeTask({ organizationSlug, taskId, weights }).then((result) => {
      pendingRef.current.delete(taskId);
      if (!result.ok) {
        dispatch({ type: "RESTORE_TASK", taskId });
        toast({ title: t("saveFailedTitle"), description: result.message, variant: "destructive" });
        void refetch();
        return;
      }
      claimAttemptsRef.current.delete(taskId);
      dispatch({ type: "COMPLETE_SUCCESS", taskId });
      toast({
        title: t("completeTitle"),
        description: customerName ? t("completeBody", { customerName }) : undefined,
      });
    });
  }, [state, organizationSlug, refetch, toast, t]);

  // Physical keyboard entry for the kiosk (md+ only, checked at event time).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!window.matchMedia("(min-width: 768px)").matches) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)) return;
      if (/^[0-9]$/.test(event.key)) {
        dispatchWithClaim({ type: "DIGIT", digit: event.key });
      } else if (event.key === "." || event.key === ",") {
        dispatchWithClaim({ type: "DOT" });
      } else if (event.key === "Backspace") {
        dispatchWithClaim({ type: "BACKSPACE" });
      } else if (event.key === "Enter") {
        dispatchWithClaim({ type: "NEXT", nowMs: Date.now() });
      } else if (event.key.toLowerCase() === "p") {
        dispatchWithClaim({ type: "TOGGLE_TARGET" });
      } else {
        return;
      }
      event.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatchWithClaim]);

  return (
    <div className="flex h-[calc(100svh-4rem-1.5rem)] flex-col gap-4 md:h-[calc(100svh-4rem-2rem)]">
      <WeighStation
        state={state}
        dispatch={dispatchWithClaim}
        people={people}
        nowMs={nowMs}
        onRelease={release}
        className="hidden md:flex"
      />
      <SwipeDeck
        state={state}
        dispatch={dispatchWithClaim}
        people={people}
        nowMs={nowMs}
        className="flex md:hidden"
      />
    </div>
  );
}
