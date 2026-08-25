"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { z } from "zod";
import { FALLBACKS, type OrderFallback, type OrderItemMode } from "@/features/orders/types";

export type CartLine = {
  productId: string;
  productName: string;
  mode: OrderItemMode;
  quantity: number;
  sizeMinKg: number;
  sizeMaxKg: number;
  fallback: OrderFallback;
};

// Validates localStorage-hydrated cart lines. A corrupt or stale shape
// (manual edits, an old cart schema version, devtools tampering) must be
// dropped per-line instead of crashing the cart/checkout render on every
// load thereafter.
const CartLineSchema = z
  .object({
    productId: z.string().uuid(),
    productName: z.string().min(1),
    mode: z.enum(["piece", "kg"]),
    quantity: z.number().positive(),
    sizeMinKg: z.number().positive(),
    sizeMaxKg: z.number().positive(),
    fallback: z.enum(FALLBACKS),
  })
  .refine((v) => v.sizeMaxKg >= v.sizeMinKg, { message: "sizeMaxKg must be >= sizeMinKg" })
  .refine((v) => v.mode !== "piece" || Number.isInteger(v.quantity), {
    message: "quantity must be a whole number for piece mode",
  });

// Exported for unit testing (see tests/unit/cart-context.test.ts). Pure and
// side-effect free -- no DOM/localStorage access -- so it's safe to test
// under vitest's node environment.
export function parseStoredCart(raw: string): CartLine[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const valid: CartLine[] = [];
  for (const entry of parsed) {
    const result = CartLineSchema.safeParse(entry);
    if (result.success) {
      valid.push(result.data);
    }
    // Invalid entries are silently dropped rather than discarding the
    // whole cart -- one corrupt line shouldn't cost the buyer their other
    // lines.
  }
  return valid;
}

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
      // Hydrating from localStorage must happen after mount: reading it in a
      // lazy initializer would make the client's first render differ from the
      // server's and trip a hydration mismatch.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItems(parseStoredCart(stored));
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
