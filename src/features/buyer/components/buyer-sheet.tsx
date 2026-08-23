"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

type BuyerSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: React.ReactNode;
};

const SPRING = { type: "spring", bounce: 0, duration: 0.4 } as const;

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Terus Segar bottom sheet: flat warm fill (NO backdrop-filter), 1:1 drag,
 * velocity dismiss, interruptible spring (motion animates from the current
 * value on re-target). Reduced motion: plain fade.
 */
export function BuyerSheet({ open, onOpenChange, title, children }: BuyerSheetProps) {
  const reduced = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  // Tracks whether the sheet is still in the DOM (including while the exit
  // animation plays), so the scroll lock isn't released until motion is done.
  const [present, setPresent] = useState(false);

  // Adjust state during render (not in an effect) to avoid an extra
  // cascading commit: https://react.dev/learn/you-might-not-need-an-effect
  if (open && !present) {
    setPresent(true);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!(open || present)) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open, present]);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      const previouslyFocused = previouslyFocusedRef.current;
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [open]);

  const handlePanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusable.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (e.shiftKey) {
      if (document.activeElement === first || document.activeElement === panel || !panel.contains(document.activeElement)) {
        e.preventDefault();
        last.focus();
      }
    } else if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <AnimatePresence onExitComplete={() => setPresent(false)}>
      {open && (
        <div className="buyer-theme fixed inset-0 z-[60]">
          <motion.button
            type="button"
            aria-label="Tutup"
            className="absolute inset-0 h-full w-full bg-foreground/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => onOpenChange(false)}
          />
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={title ?? "Helaian"}
            className="absolute inset-x-0 bottom-0 mx-auto max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-b-0 bg-card/[0.98] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-8px_30px_rgba(58,49,41,0.15)] focus:outline-none"
            initial={reduced ? { opacity: 0 } : { y: "100%" }}
            animate={reduced ? { opacity: 1 } : { y: 0 }}
            exit={reduced ? { opacity: 0 } : { y: "100%" }}
            transition={reduced ? { duration: 0.2 } : SPRING}
            drag={reduced ? false : "y"}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 500) onOpenChange(false);
            }}
            onKeyDown={handlePanelKeyDown}
          >
            <div aria-hidden className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" />
            {title && (
              <h2 className="font-buyer-display mb-3 text-xl font-semibold">{title}</h2>
            )}
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
