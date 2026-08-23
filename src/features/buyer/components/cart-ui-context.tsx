"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type CartUi = { cartOpen: boolean; openCart: () => void; closeCart: () => void };

const CartUiContext = createContext<CartUi | undefined>(undefined);

export function CartUiProvider({ children }: { children: ReactNode }) {
  const [cartOpen, setCartOpen] = useState(false);
  const openCart = useCallback(() => setCartOpen(true), []);
  const closeCart = useCallback(() => setCartOpen(false), []);
  return (
    <CartUiContext.Provider value={{ cartOpen, openCart, closeCart }}>
      {children}
    </CartUiContext.Provider>
  );
}

export function useCartUi() {
  const ctx = useContext(CartUiContext);
  if (!ctx) throw new Error("useCartUi must be used within CartUiProvider");
  return ctx;
}
