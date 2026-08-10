"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { OrderFallback, OrderItemMode } from "@/features/orders/types";

export type CartLine = {
  productId: string;
  productName: string;
  mode: OrderItemMode;
  quantity: number;
  sizeMinKg: number;
  sizeMaxKg: number;
  fallback: OrderFallback;
};

type CartContextType = {
  items: CartLine[];
  addLine: (line: CartLine) => void;
  removeLine: (index: number) => void;
  updateLine: (index: number, patch: Partial<CartLine>) => void;
  clearCart: () => void;
};

const CartContext = createContext<CartContextType | undefined>(undefined);

const CART_STORAGE_KEY = "buyer_cart_v2";

function sameLine(a: CartLine, b: CartLine) {
  return (
    a.productId === b.productId &&
    a.mode === b.mode &&
    a.sizeMinKg === b.sizeMinKg &&
    a.sizeMaxKg === b.sizeMaxKg &&
    a.fallback === b.fallback
  );
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartLine[]>([]);

  // Load cart from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(CART_STORAGE_KEY);
    if (stored) {
      try {
        // Hydrating from localStorage must happen after mount: reading it in a
        // lazy initializer would make the client's first render differ from the
        // server's and trip a hydration mismatch.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setItems(JSON.parse(stored));
      } catch {
        // Ignore invalid JSON
      }
    }
  }, []);

  // Save cart to localStorage on change
  useEffect(() => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  const addLine = useCallback((line: CartLine) => {
    setItems((current) => {
      const index = current.findIndex((existing) => sameLine(existing, line));
      if (index === -1) {
        return [...current, line];
      }
      return current.map((existing, i) =>
        i === index
          ? {
              ...existing,
              quantity:
                Math.round((existing.quantity + line.quantity) * 1000) / 1000,
            }
          : existing,
      );
    });
  }, []);

  const removeLine = useCallback((index: number) => {
    setItems((current) => current.filter((_, i) => i !== index));
  }, []);

  const updateLine = useCallback(
    (index: number, patch: Partial<CartLine>) => {
      setItems((current) =>
        current.map((line, i) => (i === index ? { ...line, ...patch } : line)),
      );
    },
    [],
  );

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  return (
    <CartContext.Provider
      value={{ items, addLine, removeLine, updateLine, clearCart }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
}
