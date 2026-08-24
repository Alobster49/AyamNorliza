"use client";

import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { isSettled, projectMomentum, rubberband, springStep } from "../lib/gesture-physics";
import {
  bandStatus,
  canUndo,
  isLineReady,
  type LineDraft,
  type WeighAction,
  type WeighState,
} from "../lib/weigh-model";
import { SwipeCard } from "./swipe-card";
import { WarehouseEmptyState } from "./warehouse-empty-state";

const EMPTY_DRAFT: LineDraft = { weightKg: "", pieces: "" };
const DRAG_THRESHOLD_PX = 10;
const COMMIT_DISTANCE_FRACTION = 0.4;
const COMMIT_PROJECTED_FRACTION = 0.35;

type SwipeDeckProps = {
  state: WeighState;
  dispatch: (action: WeighAction) => void;
  className?: string;
};

/**
 * Mobile experience: the queue as a stack of cards. The top card tracks the
 * finger 1:1 (with rubberband resistance for suspicious readings), commits
 * by momentum projection, and hands release velocity into a spring — per
 * Apple's fluid-interface model. Swipe left = skip, right = undo.
 */
export function SwipeDeck({ state, dispatch, className }: SwipeDeckProps) {
  const line = state.queue[state.cursor];
  const draft = line ? (state.drafts[line.itemId] ?? EMPTY_DRAFT) : EMPTY_DRAFT;

  const cardRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const positionRef = useRef(0);
  const velocityRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    originX: number;
    dragging: boolean;
  } | null>(null);
  const samplesRef = useRef<{ x: number; t: number }[]>([]);
  const suppressClickRef = useRef(false);
  // Latest state snapshot for handlers registered once.
  const modelRef = useRef({ state, dispatch });
  useEffect(() => {
    modelRef.current = { state, dispatch };
  });

  const applyTransform = useCallback((x: number) => {
    const el = cardRef.current;
    if (!el) return;
    el.style.transform = `translateX(${x}px) rotate(${x / 20}deg)`;
  }, []);

  const stopAnimation = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const reducedMotion = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** Spring the card to `target` from its live position, then run onDone. */
  const animateTo = useCallback(
    (target: number, dampingRatio: number, onDone?: () => void) => {
      stopAnimation();
      if (reducedMotion()) {
        const el = cardRef.current;
        if (el && target !== 0) {
          // Cross-fade instead of a slide for reduced motion.
          el.style.transition = "opacity 150ms ease";
          el.style.opacity = "0";
          window.setTimeout(() => {
            el.style.transition = "";
            el.style.opacity = "";
            positionRef.current = 0;
            velocityRef.current = 0;
            applyTransform(0);
            onDone?.();
          }, 160);
          return;
        }
        positionRef.current = 0;
        velocityRef.current = 0;
        applyTransform(0);
        onDone?.();
        return;
      }
      let last = performance.now();
      const tick = (now: number) => {
        const dt = Math.min((now - last) / 1000, 1 / 30);
        last = now;
        const next = springStep(
          { position: positionRef.current, velocity: velocityRef.current },
          target,
          dampingRatio,
          0.35,
          dt,
        );
        positionRef.current = next.position;
        velocityRef.current = next.velocity;
        applyTransform(next.position);
        if (isSettled(next, target, 0.5, 5)) {
          positionRef.current = target;
          applyTransform(target);
          rafRef.current = null;
          onDone?.();
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [applyTransform, stopAnimation],
  );

  /** Fly the card off-screen, dispatch, then reset for the next card. */
  const commit = useCallback(
    (direction: -1 | 1, action: WeighAction) => {
      const width = wrapperRef.current?.clientWidth ?? 320;
      animateTo(direction * (width * 1.2 + 40), 0.8, () => {
        modelRef.current.dispatch(action);
        positionRef.current = 0;
        velocityRef.current = 0;
        applyTransform(0);
      });
    },
    [animateTo, applyTransform],
  );

  // Reset transform whenever the top card changes identity.
  useEffect(() => {
    stopAnimation();
    positionRef.current = 0;
    velocityRef.current = 0;
    applyTransform(0);
  }, [line?.itemId, applyTransform, stopAnimation]);

  useEffect(() => stopAnimation, [stopAnimation]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!line) return;
    // Grab: origin is the live position so a mid-flight card can be caught.
    stopAnimation();
    dragRef.current = {
      pointerId: e.pointerId,
      originX: e.clientX - positionRef.current,
      dragging: false,
    };
    samplesRef.current = [{ x: e.clientX, t: e.timeStamp }];
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const rawDx = e.clientX - drag.originX;
    if (!drag.dragging) {
      if (Math.abs(rawDx) < DRAG_THRESHOLD_PX) return;
      drag.dragging = true;
      suppressClickRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const { state: current } = modelRef.current;
    const currentLine = current.queue[current.cursor];
    const currentDraft = currentLine
      ? (current.drafts[currentLine.itemId] ?? EMPTY_DRAFT)
      : EMPTY_DRAFT;
    const width = wrapperRef.current?.clientWidth ?? 320;
    const suspicious = currentLine && bandStatus(currentLine, currentDraft) === "out_of_band";
    const dx = suspicious ? rubberband(rawDx, width) : rawDx;
    positionRef.current = dx;
    applyTransform(dx);
    const samples = samplesRef.current;
    samples.push({ x: e.clientX, t: e.timeStamp });
    if (samples.length > 6) samples.shift();
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    if (!drag.dragging) return;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);

    // Release velocity from the last ~100ms of samples.
    const samples = samplesRef.current;
    const nowSample = { x: e.clientX, t: e.timeStamp };
    const past = samples.find((s) => nowSample.t - s.t <= 100) ?? samples[0] ?? nowSample;
    const dtMs = nowSample.t - past.t;
    const velocity = dtMs > 0 ? ((nowSample.x - past.x) / dtMs) * 1000 : 0;
    velocityRef.current = velocity;

    const width = wrapperRef.current?.clientWidth ?? 320;
    const position = positionRef.current;
    const projected = position + projectMomentum(velocity);
    const shouldCommit =
      Math.abs(projected) > width * COMMIT_PROJECTED_FRACTION ||
      Math.abs(position) > width * COMMIT_DISTANCE_FRACTION;
    const direction: -1 | 1 = (shouldCommit ? projected : position) < 0 ? -1 : 1;

    const { state: current } = modelRef.current;
    if (shouldCommit && direction === -1) {
      commit(-1, { type: "SKIP" });
      return;
    }
    if (shouldCommit && direction === 1 && canUndo(current)) {
      commit(1, { type: "UNDO" });
      return;
    }
    // Not committing (or undo not allowed): spring home, no bounce.
    animateTo(0, 1.0);
  };

  const onNumpad = (action: "digit" | "dot" | "backspace" | "toggle", digit?: string) => {
    if (action === "digit" && digit) dispatch({ type: "DIGIT", digit });
    else if (action === "dot") dispatch({ type: "DOT" });
    else if (action === "backspace") dispatch({ type: "BACKSPACE" });
    else if (action === "toggle") dispatch({ type: "TOGGLE_TARGET" });
  };

  if (!line) {
    return (
      <div className={cn("flex flex-1 items-center justify-center", className)}>
        <WarehouseEmptyState />
      </div>
    );
  }

  const taskLines = state.queue.filter((l) => l.taskId === line.taskId);
  const peek = [state.queue[state.cursor + 1], state.queue[state.cursor + 2]].filter(
    (l): l is NonNullable<typeof l> => Boolean(l),
  );

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-3", className)}>
      {/* Progress ticks for the current order */}
      <div className="flex gap-1" aria-label={`Order progress: ${line.customerName}`}>
        {taskLines.map((l) => (
          <span
            key={l.itemId}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-200 motion-reduce:transition-none",
              state.confirmed[l.itemId]
                ? "bg-emerald-500"
                : l.itemId === line.itemId
                  ? "bg-primary"
                  : "bg-muted",
            )}
          />
        ))}
      </div>

      <div ref={wrapperRef} className="relative flex-1">
        {/* Peek cards behind the stack */}
        {peek.map((l, i) => (
          <div
            key={l.itemId}
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 origin-top rounded-2xl border bg-card opacity-60"
            style={{
              transform: `scale(${1 - 0.04 * (i + 1)}) translateY(${-8 * (i + 1)}px)`,
              zIndex: -1 - i,
              height: "40px",
            }}
          />
        ))}
        <div
          className="relative h-full touch-pan-y"
          style={{ touchAction: "pan-y" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClickCapture={(e) => {
            if (suppressClickRef.current) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
        >
          <SwipeCard
            ref={cardRef}
            line={line}
            draft={draft}
            entryTarget={state.entryTarget}
            interactive
            onDispatchNumpad={onNumpad}
            onSave={() => commit(-1, { type: "NEXT" })}
            onSkip={() => commit(-1, { type: "SKIP" })}
          />
        </div>
      </div>
    </div>
  );
}
