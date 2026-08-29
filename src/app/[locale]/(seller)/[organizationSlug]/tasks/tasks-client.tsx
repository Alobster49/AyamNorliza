"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { claimWeighTask, completeTask, getTodayTasks } from "@/features/orders/server/order-actions";
import type { TaskWithOrder } from "@/features/orders/types";
import {
  buildCompletePayload,
  createWeighState,
  firstReadyUnsubmittedTaskId,
  isTaskMineActive,
  isTaskStartable,
  weighReducer,
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
  // Sequence guard: two overlapping refetches can resolve out of order, and
  // an older SYNC_TASKS must not clobber state a newer one already wrote.
  const refetchSeqRef = useRef(0);
  const refetch = useCallback(async () => {
    const seq = ++refetchSeqRef.current;
    try {
      const result = await getTodayTasks(organizationSlug);
      if (seq !== refetchSeqRef.current) return;
      if (result.ok) {
        dispatch({ type: "SYNC_TASKS", tasks: result.data.tasks, nowMs: Date.now() });
        setPeople(result.data.people);
      }
    } catch {
      // Network hiccup: swallow — the next realtime event or 60s claim-tick
      // retries, and the queue self-heals without surfacing an error.
    }
  }, [organizationSlug]);

  // ---- explicit Start ----
  // One in-flight Start per task at a time; cleared when the attempt settles
  // so a later Start (e.g. after re-appearing unclaimed) can fire again.
  const startPendingRef = useRef<Set<string>>(new Set());
  const startTask = useCallback(
    (taskId: string) => {
      if (startPendingRef.current.has(taskId)) return;
      startPendingRef.current.add(taskId);
      dispatch({ type: "CLAIM_LOCAL", taskId, by: viewerId, at: new Date().toISOString() });
      void claimWeighTask({ organizationSlug, taskId, claim: true })
        .then((result) => {
          if (!result.ok) {
            // "conflict" also covers task_done: a claim RPC that resolves
            // after we already completed this task ourselves must not show
            // a bogus "Order taken" toast or move the cursor. Only
            // claimedByOther means someone else actually holds it.
            if (
              result.messageKey === "errors.orders.tasks.claimedByOther" &&
              stateRef.current.queue.some((line) => line.taskId === taskId)
            ) {
              dispatch({ type: "CLAIM_REJECTED", taskId, nowMs: Date.now() });
              toast({ title: t("claimLostTitle"), description: result.message, variant: "destructive" });
            } else {
              dispatch({ type: "CLAIM_CLEARED", taskId });
            }
          }
          void refetch();
        })
        .catch(() => {
          // The request never reached the server (offline/dropped): roll
          // back the optimistic claim so Start reappears instead of leaving
          // the task claimed forever.
          dispatch({ type: "CLAIM_CLEARED", taskId });
          toast({ title: t("saveFailedTitle"), variant: "destructive" });
        })
        .finally(() => {
          startPendingRef.current.delete(taskId);
        });
    },
    [organizationSlug, refetch, t, toast, viewerId],
  );

  const release = useCallback(
    (taskId: string) => {
      dispatch({ type: "CLAIM_CLEARED", taskId });
      void claimWeighTask({ organizationSlug, taskId, claim: false })
        .then((result) => {
          if (!result.ok) {
            toast({ title: t("saveFailedTitle"), description: result.message, variant: "destructive" });
          }
          void refetch();
        })
        .catch(() => {
          // Request never reached the server: the optimistic clear already
          // happened locally, and claims resync on the next realtime event
          // or interaction, so there's nothing to roll back here.
          toast({ title: t("saveFailedTitle"), variant: "destructive" });
        });
    },
    [organizationSlug, refetch, t, toast],
  );

  // ---- realtime: other stations' claims and completions land here ----
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const channel = supabase
      .channel(`weigh-queue-${orgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_tasks", filter: `organization_id=eq.${orgId}` },
        () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => void refetchRef.current(), 400);
        },
      );
    // The browser client starts realtime with the anon key; RLS rejects the
    // subscription until the user token is set, so wait for the session first.
    void supabase.auth.getSession().then(({ data }) => {
      if (disposed) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      channel.subscribe((status, err) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error(`realtime ${status}`, err);
        }
      });
    });
    return () => {
      disposed = true;
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
      const line = stateRef.current.queue[stateRef.current.cursor];
      const mineActive = !!line && isTaskMineActive(stateRef.current, line.taskId, Date.now());
      if (/^[0-9]$/.test(event.key)) {
        if (!mineActive) return;
        dispatch({ type: "DIGIT", digit: event.key });
      } else if (event.key === "." || event.key === ",") {
        if (!mineActive) return;
        dispatch({ type: "DOT" });
      } else if (event.key === "Backspace") {
        if (!mineActive) return;
        dispatch({ type: "BACKSPACE" });
      } else if (event.key === "Enter") {
        if (!line) return;
        if (isTaskStartable(stateRef.current, line.taskId, Date.now())) {
          startTask(line.taskId);
        } else if (mineActive) {
          dispatch({ type: "NEXT", nowMs: Date.now() });
        } else {
          return;
        }
      } else if (event.key.toLowerCase() === "p") {
        if (!mineActive) return;
        dispatch({ type: "TOGGLE_TARGET" });
      } else {
        return;
      }
      event.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [startTask]);

  return (
    <div className="flex h-[calc(100svh-4rem-1.5rem)] flex-col gap-4 md:h-[calc(100svh-4rem-2rem)]">
      <WeighStation
        state={state}
        dispatch={dispatch}
        onStart={startTask}
        people={people}
        nowMs={nowMs}
        onRelease={release}
        className="hidden md:flex"
      />
      <SwipeDeck
        state={state}
        dispatch={dispatch}
        onStart={startTask}
        people={people}
        nowMs={nowMs}
        className="flex md:hidden"
      />
    </div>
  );
}
