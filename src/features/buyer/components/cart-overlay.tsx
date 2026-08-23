"use client";

import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useCart } from "./cart-context";
import { useCartUi } from "./cart-ui-context";
import { BuyerSheet } from "./buyer-sheet";
import { CartView } from "./cart-view";
import { cartEstimate, formatEstimate } from "@/features/buyer/lib/price-estimate";

export function CartOverlay({ organizationSlug }: { organizationSlug: string }) {
  const pathname = usePathname();
  const { items } = useCart();
  const { cartOpen, openCart, closeCart } = useCartUi();
  const total = cartEstimate(items);

  const onQuietRoute =
    pathname.endsWith("/cart") || pathname.endsWith("/checkout") || pathname.endsWith("/login");
  const showBar = items.length > 0 && !onQuietRoute && !cartOpen;

  return (
    <>
      <AnimatePresence>
        {showBar && (
          <motion.div
            initial={{ y: 90 }}
            animate={{ y: 0 }}
            exit={{ y: 90 }}
            transition={{ type: "spring", bounce: 0, duration: 0.4 }}
            className="fixed inset-x-0 bottom-0 z-50 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            <button
              type="button"
              onClick={openCart}
              className="buyer-theme mx-auto flex w-full max-w-lg items-center justify-between rounded-full border bg-foreground px-5 py-3 text-background shadow-lg transition-transform active:scale-[0.98]"
            >
              <span className="font-buyer-mono text-sm">
                {items.length} item{total ? ` · ${formatEstimate(total)}` : ""}
              </span>
              <span className="font-medium text-primary">Lihat troli</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <BuyerSheet open={cartOpen} onOpenChange={(o) => (o ? openCart() : closeCart())} title="Troli Anda">
        <CartView organizationSlug={organizationSlug} onNavigate={closeCart} />
      </BuyerSheet>
    </>
  );
}
