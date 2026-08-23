"use client";

import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

type BuyerSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: React.ReactNode;
};

const SPRING = { type: "spring", bounce: 0, duration: 0.4 } as const;

/**
 * Terus Segar bottom sheet: flat warm fill (NO backdrop-filter), 1:1 drag,
 * velocity dismiss, interruptible spring (motion animates from the current
 * value on re-target). Reduced motion: plain fade.
 */
export function BuyerSheet({ open, onOpenChange, title, children }: BuyerSheetProps) {
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onOpenChange]);

  return (
    <AnimatePresence>
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
            role="dialog"
            aria-modal="true"
            aria-label={title ?? "Sheet"}
            className="absolute inset-x-0 bottom-0 mx-auto max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-b-0 bg-card/[0.98] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-8px_30px_rgba(58,49,41,0.15)]"
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
