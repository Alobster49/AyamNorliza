# Terus Segar Buy-Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the buyer portal buy flow (shop → cart → checkout → confirmation → orders) as the warm-paper "Terus Segar" design: light `.buyer-theme` token scope, Fraunces/Schibsted/Plex Mono type, a reusable ScaleChip price object, sheet-based cart, one-screen checkout with inline account creation, and status tracking — with no schema changes and no new server actions.

**Architecture:** All visual change is scoped to `src/app/buyer_portal/**` and `src/features/buyer/**` via a `.buyer-theme` CSS class that redefines the shadcn tokens for that subtree (child custom-property definitions beat the inherited `.dark` values — no next-themes surgery). New pure libs (`price-estimate`, `checkout-cta`, `explainer-flag`, `order-tracker` mapping) carry the testable logic; presentation components consume them. Checkout drops `requireBuyerOrRedirect` and embeds signup/signin as its first section, calling the existing `buyerSignUpAction`/`buyerSignInAction` then `placeOrder` sequentially.

**Tech Stack:** Next.js 16 App Router, React 18, Tailwind CSS 4, shadcn/ui, `motion` (new dep) for springs/drag, next/font (Fraunces, Schibsted Grotesk, IBM Plex Mono), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-23-terus-segar-buy-flow-design.md`

## Global Constraints

- Seller dashboard, root layout, root `--font-ui`, and DM Serif Display setup are untouched. Everything visual lives under `.buyer-theme`.
- No schema changes; no new server actions. Reuse: `buyerSignUpAction`, `buyerSignInAction` (`src/features/buyer-auth/server/auth-actions.ts:35,104`), `getPublicCatalog`, `listMyAddresses`, `createAddress`, `getActiveZones`, `getDeliveryOptions`, `resolveZoneForPostcode`, `placeOrder`, `getMyOrders`, `getMyOrder`.
- Cart storage key stays `buyer_cart_v2`; `CartLine` gains only OPTIONAL fields (`pricePerUnit`, `unitType`) so stored carts keep parsing.
- Motion contract: springs `bounce: 0, duration: 0.4` (damping 1.0 feel), press feedback on pointer-down (`scale 0.97`), sheets drag-dismissable, `prefers-reduced-motion` swaps motion for ≤200ms fades (use `useReducedMotion()` from motion/react), NO `backdrop-filter` anywhere.
- Color roles: turmeric `--primary` for CTAs; chili `--buyer-delta` ONLY for the estimate→final delta; kampung green `--buyer-confirmed` ONLY for confirmed states (zone ✓, slot ✓, delivered/closed). Never repeat weighed-pricing disclaimer prose on cards/cart/checkout — the tilde `~` + ScaleChip carry it.
- Buyer-facing microcopy is Bahasa Malaysia (exact strings are in the tasks; e2e regexes must match them). `FALLBACK_LABELS` in `src/features/orders/types.ts` is shared with the seller UI — do NOT edit it; buyer BM labels live in a new buyer-side map.
- Local gates: `npm run typecheck`, `npm run lint`, `npm test` (Vitest), `npm run test:e2e` (needs dev stack + `npx supabase start`). `npm run db:test` only if you touched SQL (this plan doesn't).
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Execution happens on a worktree branch `feature/terus-segar-buy-flow` (create via superpowers:using-git-worktrees at execution time).

---

### Task 1: Foundation — motion dep, buyer fonts, `.buyer-theme` tokens

**Files:**
- Modify: `package.json` (add `motion`)
- Modify: `src/app/globals.css` (append `.buyer-theme` block after the `.dark` block, ~line 107)
- Modify: `src/app/buyer_portal/[organizationSlug]/layout.tsx`

**Interfaces:**
- Produces: CSS class `buyer-theme` (token scope + grain + base font), utility classes `.font-buyer-display`, `.font-buyer-mono`, CSS vars `--buyer-delta`, `--buyer-confirmed`, `--font-buyer-display/-ui/-mono`. Every later task's components assume they render inside this wrapper.

- [ ] **Step 1: Install motion**

Run: `npm install motion`
Expected: `motion` appears in `package.json` dependencies (v12.x).

- [ ] **Step 2: Append the buyer theme block to globals.css**

Append at the end of `src/app/globals.css`:

```css
/* ---------------------------------------------------------------------------
 * Terus Segar buyer-portal theme. A token SCOPE, not a mode: the wrapper div
 * in the buyer layout carries .buyer-theme, and these definitions override
 * the inherited :root/.dark values for the whole subtree regardless of the
 * html-level theme class.
 * ------------------------------------------------------------------------- */
.buyer-theme {
  color-scheme: light;
  font-family: var(--font-buyer-ui), ui-sans-serif, system-ui, sans-serif;

  --background: oklch(0.97 0.015 78);
  --foreground: oklch(0.24 0.02 55);
  --card: oklch(0.985 0.012 78);
  --card-foreground: oklch(0.24 0.02 55);
  --popover: oklch(0.985 0.012 78);
  --popover-foreground: oklch(0.24 0.02 55);
  --primary: oklch(0.74 0.16 76);
  --primary-foreground: oklch(0.24 0.02 55);
  --secondary: oklch(0.93 0.02 78);
  --secondary-foreground: oklch(0.24 0.02 55);
  --muted: oklch(0.93 0.02 78);
  --muted-foreground: oklch(0.45 0.025 60);
  --accent: oklch(0.93 0.02 78);
  --accent-foreground: oklch(0.24 0.02 55);
  --border: oklch(0.24 0.02 55 / 14%);
  --input: oklch(0.24 0.02 55 / 18%);
  --ring: oklch(0.74 0.16 76);

  /* Reserved roles — see Global Constraints. */
  --buyer-delta: oklch(0.57 0.18 28);
  --buyer-confirmed: oklch(0.56 0.09 145);

  background-color: var(--background);
  color: var(--foreground);
  /* 3% paper grain, no asset. */
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E");
}

.font-buyer-display {
  font-family: var(--font-buyer-display), Georgia, "Times New Roman", serif;
}

.font-buyer-mono {
  font-family: var(--font-buyer-mono), ui-monospace, SFMono-Regular, monospace;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 3: Load the three fonts and wrap the buyer layout**

Replace `src/app/buyer_portal/[organizationSlug]/layout.tsx` content — same data fetching, new wrapper:

```tsx
import { Fraunces, Schibsted_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSessionProvider } from "@/components/providers/supabase-session-provider";
import { BuyerHeader } from "@/features/buyer/components/buyer-header";
import { CartProvider } from "@/features/buyer/components/cart-context";

const fraunces = Fraunces({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-buyer-display",
});
const schibsted = Schibsted_Grotesk({
  subsets: ["latin"],
  variable: "--font-buyer-ui",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-buyer-mono",
});

type BuyerLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ organizationSlug: string }>;
};

export default async function BuyerLayout({ children, params }: BuyerLayoutProps) {
  const { organizationSlug } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let buyerName: string | undefined;
  let isLoggedIn = false;

  if (user) {
    const { data: buyer } = await supabase
      .from("buyers")
      .select("display_name")
      .eq("id", user.id)
      .single();
    if (buyer) {
      buyerName = buyer.display_name;
      isLoggedIn = true;
    }
  }

  return (
    <SupabaseSessionProvider>
      <CartProvider>
        <div
          className={`buyer-theme min-h-screen ${fraunces.variable} ${schibsted.variable} ${plexMono.variable}`}
        >
          <BuyerHeader
            organizationSlug={organizationSlug}
            buyerName={buyerName}
            isLoggedIn={isLoggedIn}
          />
          <main className="container mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </main>
        </div>
      </CartProvider>
    </SupabaseSessionProvider>
  );
}
```

- [ ] **Step 4: Gates + visual check**

Run: `npm run typecheck && npm run lint`
Expected: clean. Then load `/buyer_portal/ayam-norliza-pilot/shop` in the dev server: page ground is cream (not white/black) even with the app in dark mode, body text is Schibsted Grotesk.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/app/globals.css 'src/app/buyer_portal/[organizationSlug]/layout.tsx'
git commit -m "feat(buyer): terus segar foundation — motion dep, buyer fonts, .buyer-theme token scope"
```

---

### Task 2: Price-estimate lib + optional price fields on CartLine (TDD)

**Files:**
- Create: `src/features/buyer/lib/price-estimate.ts`
- Create: `src/features/buyer/tests/unit/price-estimate.test.ts`
- Modify: `src/features/buyer/components/cart-context.tsx:14-41` (CartLine type + schema)
- Create: `src/features/buyer/tests/unit/cart-line-schema.test.ts`

**Interfaces:**
- Consumes: `CartLine`, `parseStoredCart` from `cart-context.tsx`; `OrderItemMode` from `@/features/orders/types`.
- Produces (used by Tasks 3, 6, 8, 9, 10):
  - `type PricedCartLine = CartLine` (with the new optional fields present)
  - `estimateRange(i: EstimateInput): { min: number; max: number }`
  - `cartEstimate(lines: CartLine[]): { min: number; max: number } | null`
  - `formatRM(n: number): string` → `"RM 28.00"`
  - `formatEstimate(r: { min: number; max: number }): string` → `"~RM 25.20–28.60"` or `"~RM 28.00"` when min===max
  - `deltaAgainstEstimate(est: { min: number; max: number }, finalTotal: number): { kind: "below" | "above" | "within"; amount: number }`
  - `BUYER_FALLBACK_LABELS: Record<OrderFallback, string>`

- [ ] **Step 1: Write the failing tests**

Create `src/features/buyer/tests/unit/price-estimate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  estimateRange,
  cartEstimate,
  formatRM,
  formatEstimate,
  deltaAgainstEstimate,
} from "@/features/buyer/lib/price-estimate";

describe("estimateRange", () => {
  it("kg mode on a per_kg variant is quantity × price, flat", () => {
    expect(
      estimateRange({ mode: "kg", quantity: 2.5, sizeMinKg: 1.3, sizeMaxKg: 1.6, pricePerUnit: 10, unitType: "per_kg" }),
    ).toEqual({ min: 25, max: 25 });
  });
  it("piece mode on a per_kg variant spans qty × sizeMin × price … qty × sizeMax × price", () => {
    expect(
      estimateRange({ mode: "piece", quantity: 2, sizeMinKg: 1.5, sizeMaxKg: 1.7, pricePerUnit: 10, unitType: "per_kg" }),
    ).toEqual({ min: 30, max: 34 });
  });
  it("piece mode on a per_piece variant is quantity × price, flat", () => {
    expect(
      estimateRange({ mode: "piece", quantity: 3, sizeMinKg: 1.5, sizeMaxKg: 1.7, pricePerUnit: 15, unitType: "per_piece" }),
    ).toEqual({ min: 45, max: 45 });
  });
  it("rounds to sen", () => {
    const r = estimateRange({ mode: "piece", quantity: 1, sizeMinKg: 1.55, sizeMaxKg: 1.55, pricePerUnit: 9.99, unitType: "per_kg" });
    expect(r.min).toBeCloseTo(15.48, 2);
    expect(r.min).toBe(r.max);
  });
});

describe("cartEstimate", () => {
  const base = { productId: "p", productName: "Ayam", mode: "piece" as const, quantity: 1, sizeMinKg: 1.5, sizeMaxKg: 1.7, fallback: "cancel" as const };
  it("sums line ranges", () => {
    expect(
      cartEstimate([
        { ...base, pricePerUnit: 10, unitType: "per_kg" },
        { ...base, mode: "kg", quantity: 2, pricePerUnit: 10, unitType: "per_kg" },
      ]),
    ).toEqual({ min: 35, max: 37 });
  });
  it("returns null when any line has no price (old stored cart)", () => {
    expect(cartEstimate([{ ...base }, { ...base, pricePerUnit: 10, unitType: "per_kg" }])).toBeNull();
  });
  it("returns null for an empty cart", () => {
    expect(cartEstimate([])).toBeNull();
  });
});

describe("formatting", () => {
  it("formatRM renders MYR with two decimals", () => {
    expect(formatRM(28)).toBe("RM 28.00");
  });
  it("formatEstimate collapses a flat range to a single tilde price", () => {
    expect(formatEstimate({ min: 28, max: 28 })).toBe("~RM 28.00");
  });
  it("formatEstimate renders a true range with an en dash", () => {
    expect(formatEstimate({ min: 25.2, max: 28.6 })).toBe("~RM 25.20–28.60");
  });
});

describe("deltaAgainstEstimate", () => {
  it("below the range", () => {
    expect(deltaAgainstEstimate({ min: 30, max: 34 }, 28.5)).toEqual({ kind: "below", amount: 1.5 });
  });
  it("above the range", () => {
    expect(deltaAgainstEstimate({ min: 30, max: 34 }, 35)).toEqual({ kind: "above", amount: 1 });
  });
  it("within the range", () => {
    expect(deltaAgainstEstimate({ min: 30, max: 34 }, 32)).toEqual({ kind: "within", amount: 0 });
  });
});
```

Create `src/features/buyer/tests/unit/cart-line-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseStoredCart } from "@/features/buyer/components/cart-context";

const V2_LINE = {
  productId: "6a2f8f6e-1111-4222-8333-444455556666",
  productName: "Ayam Kampung",
  mode: "piece",
  quantity: 2,
  sizeMinKg: 1.5,
  sizeMaxKg: 1.7,
  fallback: "cancel",
};

describe("parseStoredCart after optional price fields", () => {
  it("still accepts stored v2 lines without price fields", () => {
    expect(parseStoredCart(JSON.stringify([V2_LINE]))).toHaveLength(1);
  });
  it("accepts lines with the new optional price fields", () => {
    const parsed = parseStoredCart(
      JSON.stringify([{ ...V2_LINE, pricePerUnit: 9.9, unitType: "per_kg" }]),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].pricePerUnit).toBe(9.9);
    expect(parsed[0].unitType).toBe("per_kg");
  });
  it("drops a line with a non-positive price", () => {
    expect(
      parseStoredCart(JSON.stringify([{ ...V2_LINE, pricePerUnit: 0, unitType: "per_kg" }])),
    ).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/buyer/tests/unit/price-estimate.test.ts src/features/buyer/tests/unit/cart-line-schema.test.ts`
Expected: FAIL — module `price-estimate` not found; `pricePerUnit` unknown key stripped.

- [ ] **Step 3: Implement the lib**

Create `src/features/buyer/lib/price-estimate.ts`:

```ts
/**
 * Pure price-estimate math for the Terus Segar buy flow. Prices in the
 * portal are ALWAYS estimates until the order is weighed and closed; the
 * "~" tilde and the ScaleChip carry that meaning — never disclaimer prose.
 */

import type { OrderFallback, OrderItemMode } from "@/features/orders/types";
import type { CartLine } from "@/features/buyer/components/cart-context";

export type EstimateInput = {
  mode: OrderItemMode;
  quantity: number;
  sizeMinKg: number;
  sizeMaxKg: number;
  pricePerUnit: number;
  unitType: "per_kg" | "per_piece";
};

const toSen = (n: number) => Math.round(n * 100) / 100;

export function estimateRange(i: EstimateInput): { min: number; max: number } {
  if (i.unitType === "per_piece") {
    const flat = toSen(i.quantity * i.pricePerUnit);
    return { min: flat, max: flat };
  }
  if (i.mode === "kg") {
    const flat = toSen(i.quantity * i.pricePerUnit);
    return { min: flat, max: flat };
  }
  return {
    min: toSen(i.quantity * i.sizeMinKg * i.pricePerUnit),
    max: toSen(i.quantity * i.sizeMaxKg * i.pricePerUnit),
  };
}

/** Null when any line predates the price fields (old stored cart) or cart empty. */
export function cartEstimate(lines: CartLine[]): { min: number; max: number } | null {
  if (lines.length === 0) return null;
  let min = 0;
  let max = 0;
  for (const line of lines) {
    if (line.pricePerUnit === undefined || line.unitType === undefined) return null;
    const r = estimateRange({
      mode: line.mode,
      quantity: line.quantity,
      sizeMinKg: line.sizeMinKg,
      sizeMaxKg: line.sizeMaxKg,
      pricePerUnit: line.pricePerUnit,
      unitType: line.unitType,
    });
    min += r.min;
    max += r.max;
  }
  return { min: toSen(min), max: toSen(max) };
}

const rm = new Intl.NumberFormat("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatRM(n: number): string {
  return `RM ${rm.format(n)}`;
}

export function formatEstimate(r: { min: number; max: number }): string {
  if (r.min === r.max) return `~${formatRM(r.min)}`;
  return `~RM ${rm.format(r.min)}–${rm.format(r.max)}`;
}

export function deltaAgainstEstimate(
  est: { min: number; max: number },
  finalTotal: number,
): { kind: "below" | "above" | "within"; amount: number } {
  if (finalTotal < est.min) return { kind: "below", amount: toSen(est.min - finalTotal) };
  if (finalTotal > est.max) return { kind: "above", amount: toSen(finalTotal - est.max) };
  return { kind: "within", amount: 0 };
}

/** Buyer-facing BM fallback labels. FALLBACK_LABELS in orders/types.ts is
 *  shared with the seller UI and must not change. */
export const BUYER_FALLBACK_LABELS: Record<OrderFallback, string> = {
  cancel: "Batal pesanan saya",
  mix: "Campur saiz",
  upsize: "Besar pun ok",
  downsize: "Kecil pun ok",
};
```

- [ ] **Step 4: Extend CartLine (type + schema only — no behavior change)**

In `src/features/buyer/components/cart-context.tsx`, replace the `CartLine` type and the two schema fields:

```ts
export type CartLine = {
  productId: string;
  productName: string;
  mode: OrderItemMode;
  quantity: number;
  sizeMinKg: number;
  sizeMaxKg: number;
  fallback: OrderFallback;
  /** Indicative unit price captured at add-to-cart time, for estimate chips
   *  only — placeOrder never sends it. Optional so v2 carts keep parsing. */
  pricePerUnit?: number;
  unitType?: "per_kg" | "per_piece";
};
```

and inside `CartLineSchema`'s `z.object({...})`, after `fallback`:

```ts
    pricePerUnit: z.number().positive().optional(),
    unitType: z.enum(["per_kg", "per_piece"]).optional(),
```

Also extend `sameLine` (line 83) so identical products with different captured prices don't merge wrongly — append to the conjunction:

```ts
    a.pricePerUnit === b.pricePerUnit
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/features/buyer/tests/unit/price-estimate.test.ts src/features/buyer/tests/unit/cart-line-schema.test.ts`
Expected: PASS. Then `npm run typecheck`.

- [ ] **Step 6: Commit**

```bash
git add src/features/buyer/lib/price-estimate.ts src/features/buyer/tests/unit src/features/buyer/components/cart-context.tsx
git commit -m "feat(buyer): price-estimate lib + optional captured price on cart lines"
```

---

### Task 3: ScaleChip — the one reusable price object

**Files:**
- Create: `src/features/buyer/components/scale-chip.tsx`

**Interfaces:**
- Consumes: `formatRM`, `formatEstimate`, `deltaAgainstEstimate` from Task 2.
- Produces (used by Tasks 6, 8, 9, 10, 11):

```ts
type ScaleChipProps = {
  estimate: { min: number; max: number } | null; // null → "Harga selepas timbang"
  perUnitLabel?: string;                          // e.g. "RM 9.90/kg"
  final?: { total: number; weightKg?: number | null; pricePerKg?: number | null };
  onInfo?: () => void;                            // renders the ⓘ button when set
  className?: string;
};
export function ScaleChip(props: ScaleChipProps): JSX.Element;
```

- [ ] **Step 1: Implement the component**

Create `src/features/buyer/components/scale-chip.tsx`:

```tsx
"use client";

import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatEstimate,
  formatRM,
} from "@/features/buyer/lib/price-estimate";

type ScaleChipProps = {
  estimate: { min: number; max: number } | null;
  perUnitLabel?: string;
  final?: { total: number; weightKg?: number | null; pricePerKg?: number | null };
  onInfo?: () => void;
  className?: string;
};

/**
 * The single price object of the buy flow. Estimate state: mono "~RM …" +
 * a hairline gauge spanning the min–max estimate. Final state: solid amount
 * with the weighed breakdown in --buyer-delta. Never renders disclaimer
 * prose — the "~" and the gauge ARE the explanation (taught once by the
 * pricing explainer sheet).
 */
export function ScaleChip({ estimate, perUnitLabel, final, onInfo, className }: ScaleChipProps) {
  if (final) {
    return (
      <div className={cn("space-y-0.5", className)}>
        <p className="font-buyer-mono text-base font-medium">{formatRM(final.total)}</p>
        {final.weightKg != null && final.pricePerKg != null && (
          <p className="font-buyer-mono text-xs" style={{ color: "var(--buyer-delta)" }}>
            Ditimbang {Number(final.weightKg)} kg × {formatRM(Number(final.pricePerKg))}/kg
          </p>
        )}
      </div>
    );
  }

  if (!estimate) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>Harga selepas timbang</p>
    );
  }

  // Gauge: pad the domain 15% either side so a flat range still shows a mark.
  const pad = Math.max((estimate.max - estimate.min) * 0.5, estimate.max * 0.15, 1);
  const lo = estimate.min - pad;
  const hi = estimate.max + pad;
  const left = ((estimate.min - lo) / (hi - lo)) * 100;
  const width = Math.max(((estimate.max - estimate.min) / (hi - lo)) * 100, 4);

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-baseline gap-1.5">
        <span className="font-buyer-mono text-base font-medium">{formatEstimate(estimate)}</span>
        {perUnitLabel && (
          <span className="text-xs text-muted-foreground">{perUnitLabel}</span>
        )}
        {onInfo && (
          <button
            type="button"
            onClick={onInfo}
            aria-label="Kenapa harga anggaran?"
            className="text-muted-foreground transition-transform active:scale-95"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="relative h-0.5 w-24 overflow-hidden rounded-full bg-border" aria-hidden>
        <div
          className="absolute inset-y-0 rounded-full bg-primary"
          style={{ left: `${left}%`, width: `${width}%` }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Gates**

Run: `npm run typecheck && npm run lint`
Expected: clean. (Pure math already tested in Task 2; this component is exercised visually from Task 6 on.)

- [ ] **Step 3: Commit**

```bash
git add src/features/buyer/components/scale-chip.tsx
git commit -m "feat(buyer): ScaleChip price object — estimate gauge and weighed-final states"
```

---

### Task 4: BuyerSheet — drag-dismissable bottom sheet primitive

**Files:**
- Create: `src/features/buyer/components/buyer-sheet.tsx`

**Interfaces:**
- Consumes: `motion` package (`motion/react`), Task 1 theme.
- Produces (used by Tasks 5, 6, 8):

```ts
type BuyerSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;         // visually hidden if omitted-looking; always give aria label
  children: React.ReactNode;
};
export function BuyerSheet(props: BuyerSheetProps): JSX.Element;
```

- [ ] **Step 1: Implement**

Create `src/features/buyer/components/buyer-sheet.tsx`:

```tsx
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
```

- [ ] **Step 2: Gates**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/features/buyer/components/buyer-sheet.tsx
git commit -m "feat(buyer): BuyerSheet drag-dismissable bottom sheet primitive"
```

---

### Task 5: Pricing explainer — flag lib (TDD) + sheet + auto-open

**Files:**
- Create: `src/features/buyer/lib/explainer-flag.ts`
- Create: `src/features/buyer/tests/unit/explainer-flag.test.ts`
- Create: `src/features/buyer/components/pricing-explainer-sheet.tsx`

**Interfaces:**
- Consumes: `BuyerSheet` (Task 4).
- Produces (used by Tasks 7, 8):
  - `hasSeenExplainer(storage: Pick<Storage, "getItem">): boolean`
  - `markExplainerSeen(storage: Pick<Storage, "setItem">): void`
  - `EXPLAINER_FLAG_KEY = "buyer_pricing_explained_v1"`
  - `PricingExplainerSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }): JSX.Element` — marks the flag whenever it closes.

- [ ] **Step 1: Write the failing test**

Create `src/features/buyer/tests/unit/explainer-flag.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  EXPLAINER_FLAG_KEY,
  hasSeenExplainer,
  markExplainerSeen,
} from "@/features/buyer/lib/explainer-flag";

function memoryStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    dump: () => store,
  };
}

describe("explainer flag", () => {
  it("unseen by default", () => {
    expect(hasSeenExplainer(memoryStorage())).toBe(false);
  });
  it("seen after marking", () => {
    const s = memoryStorage();
    markExplainerSeen(s);
    expect(s.dump()[EXPLAINER_FLAG_KEY]).toBe("1");
    expect(hasSeenExplainer(s)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/buyer/tests/unit/explainer-flag.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement lib + sheet**

Create `src/features/buyer/lib/explainer-flag.ts`:

```ts
export const EXPLAINER_FLAG_KEY = "buyer_pricing_explained_v1";

export function hasSeenExplainer(storage: Pick<Storage, "getItem">): boolean {
  return storage.getItem(EXPLAINER_FLAG_KEY) === "1";
}

export function markExplainerSeen(storage: Pick<Storage, "setItem">): void {
  storage.setItem(EXPLAINER_FLAG_KEY, "1");
}
```

Create `src/features/buyer/components/pricing-explainer-sheet.tsx`:

```tsx
"use client";

import { Scale, Bird, BadgeCheck } from "lucide-react";
import { BuyerSheet } from "./buyer-sheet";
import { markExplainerSeen } from "@/features/buyer/lib/explainer-flag";

const FRAMES = [
  { icon: Bird, title: "Anda pilih ayam", body: "Pilih saiz dan cara potong yang anda mahu." },
  { icon: Scale, title: "Kami timbang bila sedia", body: "Setiap ekor ditimbang betul-betul sebelum dihantar." },
  { icon: BadgeCheck, title: "Harga ikut berat sebenar", body: "Harga akhir = berat sebenar × harga/kg. Tanda ~ maksudnya anggaran." },
] as const;

export function PricingExplainerSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const close = (next: boolean) => {
    if (!next) markExplainerSeen(window.localStorage);
    onOpenChange(next);
  };

  return (
    <BuyerSheet open={open} onOpenChange={close} title="Kenapa harga anggaran?">
      <div className="space-y-4">
        {FRAMES.map((f) => (
          <div key={f.title} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary">
              <f.icon className="h-4.5 w-4.5" />
            </span>
            <div>
              <p className="font-medium">{f.title}</p>
              <p className="text-sm text-muted-foreground">{f.body}</p>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => close(false)}
          className="mt-2 w-full rounded-full bg-primary py-3 font-medium text-primary-foreground transition-transform active:scale-[0.97]"
        >
          Faham!
        </button>
      </div>
    </BuyerSheet>
  );
}
```

- [ ] **Step 4: Run tests + gates**

Run: `npx vitest run src/features/buyer/tests/unit/explainer-flag.test.ts && npm run typecheck && npm run lint`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/buyer/lib/explainer-flag.ts src/features/buyer/tests/unit/explainer-flag.test.ts src/features/buyer/components/pricing-explainer-sheet.tsx
git commit -m "feat(buyer): weighed-pricing explainer sheet, taught once via localStorage flag"
```

---

### Task 6: AddToCartSheet + ProductCard reskin

**Files:**
- Create: `src/features/buyer/components/add-to-cart-sheet.tsx`
- Rewrite: `src/features/buyer/components/product-card.tsx`

**Interfaces:**
- Consumes: `BuyerSheet`, `ScaleChip`, `estimateRange`, `BUYER_FALLBACK_LABELS`, `CartLine` (with price fields), `useReducedMotion`/`motion`.
- Produces:
  - `AddToCartSheet({ product, variants, open, onOpenChange, onAdd }: { product: Product; variants: ProductVariant[]; open: boolean; onOpenChange: (o: boolean) => void; onAdd: (line: CartLine) => void })`
  - `ProductCard({ product, variants, onAddToCart, showInfo, onInfo }: { product: Product; variants?: ProductVariant[]; onAddToCart?: (line: CartLine) => void; showInfo?: boolean; onInfo?: () => void })` — the old `showAddToCart` prop is removed; the only grid callsite is updated in Task 7.
- Copy contract (e2e depends on these exact strings): card button `+ Tambah`; sheet title = product name; mode buttons `Ekor` / `Kg`; labels `Kuantiti (ekor)` / `Kuantiti (kg)`, `Saiz min (kg/ekor)`, `Saiz maks (kg/ekor)`; fallback group label `Kalau saiz tak ada?` with `BUYER_FALLBACK_LABELS` options; confirm button `Tambah ke troli`.

- [ ] **Step 1: Implement AddToCartSheet**

Create `src/features/buyer/components/add-to-cart-sheet.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { Minus, Plus, X, Shuffle, ArrowUp, ArrowDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BuyerSheet } from "./buyer-sheet";
import { ScaleChip } from "./scale-chip";
import type { CartLine } from "./cart-context";
import type { Product, ProductVariant } from "../types";
import { FALLBACKS, type OrderFallback, type OrderItemMode } from "@/features/orders/types";
import { estimateRange, BUYER_FALLBACK_LABELS, formatRM } from "@/features/buyer/lib/price-estimate";

const FALLBACK_ICONS: Record<OrderFallback, typeof X> = {
  cancel: X,
  mix: Shuffle,
  upsize: ArrowUp,
  downsize: ArrowDown,
};

type AddToCartSheetProps = {
  product: Product;
  variants: ProductVariant[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAdd: (line: CartLine) => void;
};

export function AddToCartSheet({ product, variants, open, onOpenChange, onAdd }: AddToCartSheetProps) {
  const available = variants.filter((v) => v.is_available);
  const [variantId, setVariantId] = useState(available[0]?.id ?? "");
  const variant = available.find((v) => v.id === variantId) ?? available[0] ?? null;

  const [mode, setMode] = useState<OrderItemMode>(variant?.unit_type === "per_kg" ? "kg" : "piece");
  const [quantity, setQuantity] = useState("1");
  const [sizeMinKg, setSizeMinKg] = useState("1.5");
  const [sizeMaxKg, setSizeMaxKg] = useState("1.7");
  const [fallback, setFallback] = useState<OrderFallback>("cancel");

  const parsedQuantity = Number(quantity);
  const parsedMin = Number(sizeMinKg);
  const parsedMax = Number(sizeMaxKg);
  const isValid =
    variant !== null &&
    Number.isFinite(parsedQuantity) &&
    parsedQuantity > 0 &&
    (mode === "piece" ? Number.isInteger(parsedQuantity) : true) &&
    Number.isFinite(parsedMin) && parsedMin >= 0.1 && parsedMin <= 50 &&
    Number.isFinite(parsedMax) && parsedMax >= 0.1 && parsedMax <= 50 &&
    parsedMax >= parsedMin;

  const estimate = useMemo(() => {
    if (!isValid || !variant) return null;
    return estimateRange({
      mode,
      quantity: parsedQuantity,
      sizeMinKg: parsedMin,
      sizeMaxKg: parsedMax,
      pricePerUnit: Number(variant.price_per_unit),
      unitType: variant.unit_type,
    });
  }, [isValid, variant, mode, parsedQuantity, parsedMin, parsedMax]);

  const step = (setter: (v: string) => void, current: string, delta: number, min: number, decimals: number) => {
    const next = Math.max(min, Math.round((Number(current) + delta) * 10 ** decimals) / 10 ** decimals);
    setter(String(next));
  };

  const handleAdd = () => {
    if (!isValid || !variant) return;
    onAdd({
      productId: product.id,
      productName: product.name,
      mode,
      quantity: parsedQuantity,
      sizeMinKg: parsedMin,
      sizeMaxKg: parsedMax,
      fallback,
      pricePerUnit: Number(variant.price_per_unit),
      unitType: variant.unit_type,
    });
    onOpenChange(false);
  };

  return (
    <BuyerSheet open={open} onOpenChange={onOpenChange} title={product.name}>
      <div className="space-y-5">
        {available.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {available.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setVariantId(v.id)}
                className={`rounded-full border px-3 py-1.5 text-sm transition-transform active:scale-95 ${
                  v.id === variant?.id ? "border-primary bg-primary/15 font-medium" : "border-border"
                }`}
              >
                {v.name} · {formatRM(Number(v.price_per_unit))}{v.unit_type === "per_kg" ? "/kg" : ""}
              </button>
            ))}
          </div>
        )}

        <div>
          <Label className="mb-2 block">Beli ikut</Label>
          <div className="relative grid grid-cols-2 rounded-full bg-secondary p-1" role="radiogroup" aria-label="Beli ikut">
            {(["piece", "kg"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className="relative z-10 rounded-full py-2 text-sm font-medium"
              >
                {mode === m && (
                  <motion.span
                    layoutId="mode-pill"
                    className="absolute inset-0 -z-10 rounded-full bg-card shadow-sm"
                    transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                  />
                )}
                {m === "piece" ? "Ekor" : "Kg"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label htmlFor="qty" className="mb-2 block">
            {mode === "piece" ? "Kuantiti (ekor)" : "Kuantiti (kg)"}
          </Label>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Kurang" className="flex h-11 w-11 items-center justify-center rounded-full border transition-transform active:scale-95"
              onClick={() => step(setQuantity, quantity, mode === "piece" ? -1 : -0.1, mode === "piece" ? 1 : 0.1, mode === "piece" ? 0 : 1)}>
              <Minus className="h-4 w-4" />
            </button>
            <Input id="qty" type="number" inputMode={mode === "piece" ? "numeric" : "decimal"}
              min={mode === "piece" ? 1 : 0.1} step={mode === "piece" ? 1 : 0.1}
              value={quantity} onChange={(e) => setQuantity(e.target.value)}
              className="h-11 text-center font-buyer-mono" />
            <button type="button" aria-label="Tambah kuantiti" className="flex h-11 w-11 items-center justify-center rounded-full border transition-transform active:scale-95"
              onClick={() => step(setQuantity, quantity, mode === "piece" ? 1 : 0.1, mode === "piece" ? 1 : 0.1, mode === "piece" ? 0 : 1)}>
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="size-min" className="mb-2 block">Saiz min (kg/ekor)</Label>
            <Input id="size-min" type="number" inputMode="decimal" min={0.1} max={50} step={0.1}
              value={sizeMinKg} onChange={(e) => setSizeMinKg(e.target.value)} className="h-11 font-buyer-mono" />
          </div>
          <div>
            <Label htmlFor="size-max" className="mb-2 block">Saiz maks (kg/ekor)</Label>
            <Input id="size-max" type="number" inputMode="decimal" min={0.1} max={50} step={0.1}
              value={sizeMaxKg} onChange={(e) => setSizeMaxKg(e.target.value)} className="h-11 font-buyer-mono" />
          </div>
        </div>

        <div>
          <Label className="mb-2 block">Kalau saiz tak ada?</Label>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Kalau saiz tak ada?">
            {FALLBACKS.map((value) => {
              const Icon = FALLBACK_ICONS[value];
              const selected = fallback === value;
              return (
                <button key={value} type="button" role="radio" aria-checked={selected}
                  onClick={() => setFallback(value)}
                  className={`flex items-center gap-2 rounded-2xl border p-3 text-left text-sm transition-transform active:scale-[0.97] ${
                    selected ? "border-primary bg-primary/15 font-medium" : "border-border"
                  }`}>
                  <Icon className="h-4 w-4 shrink-0" />
                  {BUYER_FALLBACK_LABELS[value]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between border-t pt-4">
          <ScaleChip estimate={estimate} />
          <button type="button" onClick={handleAdd} disabled={!isValid}
            className="rounded-full bg-primary px-6 py-3 font-medium text-primary-foreground transition-transform active:scale-[0.97] disabled:opacity-50">
            Tambah ke troli
          </button>
        </div>
      </div>
    </BuyerSheet>
  );
}
```

- [ ] **Step 2: Rewrite ProductCard**

Replace `src/features/buyer/components/product-card.tsx`:

```tsx
"use client";

import { useState } from "react";
import Image from "next/image";
import { Bird } from "lucide-react";
import { ScaleChip } from "./scale-chip";
import { AddToCartSheet } from "./add-to-cart-sheet";
import { estimateRange, formatRM } from "@/features/buyer/lib/price-estimate";
import type { CartLine } from "./cart-context";
import type { Product, ProductVariant } from "../types";

type ProductCardProps = {
  product: Product;
  variants?: ProductVariant[];
  onAddToCart?: (line: CartLine) => void;
  /** Exactly one card on the shop page gets the ⓘ (the first). */
  showInfo?: boolean;
  onInfo?: () => void;
};

export function ProductCard({ product, variants = [], onAddToCart, showInfo, onInfo }: ProductCardProps) {
  const [open, setOpen] = useState(false);
  const available = variants.filter((v) => v.is_available);
  const primary = available[0] ?? null;

  // Card-level estimate: the default 1 × 1.5–1.7 kg bird (or 1 piece/kg).
  const estimate = primary
    ? estimateRange({
        mode: primary.unit_type === "per_kg" ? "piece" : "piece",
        quantity: 1,
        sizeMinKg: 1.5,
        sizeMaxKg: 1.7,
        pricePerUnit: Number(primary.price_per_unit),
        unitType: primary.unit_type,
      })
    : null;

  return (
    <article data-slot="card" className="overflow-hidden rounded-2xl border bg-card shadow-[0_2px_10px_rgba(58,49,41,0.06)]">
      <div className="relative aspect-[4/3] bg-secondary">
        {product.image_url ? (
          <Image src={product.image_url} alt={product.name} fill className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground/60">
            <Bird className="h-12 w-12" strokeWidth={1.25} />
          </div>
        )}
      </div>
      <div className="space-y-3 p-4">
        <h3 className="font-buyer-display text-lg font-semibold leading-tight">{product.name}</h3>
        <ScaleChip
          estimate={estimate}
          perUnitLabel={primary ? `${formatRM(Number(primary.price_per_unit))}${primary.unit_type === "per_kg" ? "/kg" : "/ekor"}` : undefined}
          onInfo={showInfo ? onInfo : undefined}
        />
        {onAddToCart && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={!primary}
            className="w-full rounded-full bg-primary py-2.5 font-medium text-primary-foreground transition-transform active:scale-[0.97] disabled:opacity-50"
          >
            + Tambah
          </button>
        )}
      </div>
      {onAddToCart && (
        <AddToCartSheet
          product={product}
          variants={variants}
          open={open}
          onOpenChange={setOpen}
          onAdd={onAddToCart}
        />
      )}
    </article>
  );
}
```

- [ ] **Step 3: Fix the one existing callsite**

`src/app/buyer_portal/[organizationSlug]/shop/product-grid.tsx:36-42` passes `showAddToCart={true}` — remove that prop for now (Task 7 replaces this file entirely; this keeps typecheck green in between):

```tsx
              <ProductCard
                key={product.id}
                product={product}
                variants={product.variants ?? []}
                onAddToCart={handleAddToCart}
              />
```

- [ ] **Step 4: Gates + tests**

Run: `npm run typecheck && npm run lint && npm test`
Expected: clean, all unit tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/buyer/components/add-to-cart-sheet.tsx src/features/buyer/components/product-card.tsx 'src/app/buyer_portal/[organizationSlug]/shop/product-grid.tsx'
git commit -m "feat(buyer): add-to-cart sheet with size range + fallback cards, product card reskin"
```

---

### Task 7: Shop page — hero, category rail, explainer auto-open

**Files:**
- Rewrite: `src/app/buyer_portal/[organizationSlug]/shop/product-grid.tsx` → shop client with rail + explainer
- Modify: `src/app/buyer_portal/[organizationSlug]/shop/page.tsx`

**Interfaces:**
- Consumes: `getPublicCatalog` (server, unchanged), `ProductCard` (Task 6), `PricingExplainerSheet` + `hasSeenExplainer` (Task 5), `useCart`.
- Produces: `ShopClient({ categories }: { categories: CatalogWithProducts[] })` default-exported from `product-grid.tsx` (path kept to minimize churn).

- [ ] **Step 1: Rewrite product-grid.tsx as ShopClient**

```tsx
"use client";

import { useEffect, useState } from "react";
import { ProductCard } from "@/features/buyer/components/product-card";
import { PricingExplainerSheet } from "@/features/buyer/components/pricing-explainer-sheet";
import { hasSeenExplainer } from "@/features/buyer/lib/explainer-flag";
import { useCart } from "@/features/buyer/components/cart-context";
import type { CatalogWithProducts } from "@/features/buyer/types";

export function ShopClient({ categories }: { categories: CatalogWithProducts[] }) {
  const { addLine } = useCart();
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [explainerOpen, setExplainerOpen] = useState(false);

  // Taught once: auto-open on the first ever shop visit.
  useEffect(() => {
    if (!hasSeenExplainer(window.localStorage)) {
      const t = setTimeout(() => setExplainerOpen(true), 600);
      return () => clearTimeout(t);
    }
  }, []);

  const visible =
    activeCategory === "all" ? categories : categories.filter((c) => c.id === activeCategory);
  let infoAssigned = false;

  return (
    <div className="space-y-8">
      <nav
        aria-label="Kategori"
        className="sticky top-16 z-40 -mx-4 flex gap-2 overflow-x-auto bg-background/95 px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 [scrollbar-width:none] snap-x"
      >
        {[{ id: "all", name: "Semua" }, ...categories].map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setActiveCategory(c.id)}
            className={`shrink-0 snap-start rounded-full border px-4 py-1.5 text-sm transition-transform active:scale-95 ${
              activeCategory === c.id
                ? "border-foreground bg-foreground font-medium text-background"
                : "border-border bg-card"
            }`}
          >
            {c.name}
          </button>
        ))}
      </nav>

      {visible.map((category) => (
        <section key={category.id} className="space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-buyer-display text-2xl font-semibold">{category.name}</h2>
            {category.description && (
              <p className="hidden text-sm text-muted-foreground sm:block">{category.description}</p>
            )}
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {category.products.map((product) => {
              const showInfo = !infoAssigned;
              if (showInfo) infoAssigned = true;
              return (
                <ProductCard
                  key={product.id}
                  product={product}
                  variants={product.variants ?? []}
                  onAddToCart={addLine}
                  showInfo={showInfo}
                  onInfo={() => setExplainerOpen(true)}
                />
              );
            })}
          </div>
        </section>
      ))}

      <PricingExplainerSheet open={explainerOpen} onOpenChange={setExplainerOpen} />
    </div>
  );
}
```

- [ ] **Step 2: New hero in page.tsx**

In `src/app/buyer_portal/[organizationSlug]/shop/page.tsx`, update the import and replace the hero `<section>` (lines 43-51) and grid call:

```tsx
import { ShopClient } from "./product-grid";
```

```tsx
      <section className="relative overflow-hidden rounded-3xl border bg-card px-6 py-14 sm:px-12 sm:py-20">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 85% 20%, var(--primary) 0, transparent 45%)",
          }}
        />
        <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
          Ladang AyamNorliza
        </p>
        <h1 className="font-buyer-display mt-3 max-w-2xl text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
          Ayam segar, ditimbang betul.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-muted-foreground">
          Pilih ayam anda hari ini — kami timbang depan mata dan sahkan harga ikut
          berat sebenar.
        </p>
      </section>

      <ShopClient categories={categories} />
```

Keep the error/empty states; update the empty-state copy to `"Tiada produk lagi — datang balik nanti!"`.

- [ ] **Step 3: Gates + visual**

Run: `npm run typecheck && npm run lint`. Dev server: shop shows cream hero with Fraunces headline, chip rail sticks under the header, first card has ⓘ, tapping + Tambah opens the sheet, explainer auto-opens on first visit (clear `buyer_pricing_explained_v1` in devtools to re-test).

- [ ] **Step 4: Commit**

```bash
git add 'src/app/buyer_portal/[organizationSlug]/shop'
git commit -m "feat(buyer): shop hero, sticky category rail, explainer auto-open"
```

---

### Task 8: Cart — shared CartView, peek bar, cart sheet, page, header wiring

**Files:**
- Create: `src/features/buyer/components/cart-ui-context.tsx`
- Create: `src/features/buyer/components/cart-view.tsx`
- Create: `src/features/buyer/components/cart-overlay.tsx`
- Rewrite: `src/app/buyer_portal/[organizationSlug]/cart/page.tsx`
- Modify: `src/app/buyer_portal/[organizationSlug]/layout.tsx` (mount provider + overlay)
- Modify: `src/features/buyer/components/buyer-header.tsx` (cart button opens sheet)

**Interfaces:**
- Consumes: `useCart`, `cartEstimate`, `formatEstimate`, `ScaleChip`, `BuyerSheet`, `PricingExplainerSheet`, `BUYER_FALLBACK_LABELS`, `motion`.
- Produces:
  - `CartUiProvider({ children })` + `useCartUi(): { openCart: () => void; closeCart: () => void; cartOpen: boolean }`
  - `CartView({ organizationSlug, onNavigate }: { organizationSlug: string; onNavigate?: () => void })` — rows + totals + Teruskan CTA (`onNavigate` closes the sheet before push).
  - `CartOverlay({ organizationSlug })` — renders PeekCartBar + the cart BuyerSheet; hides the bar on `/cart` and `/checkout` routes and when empty.
- Copy contract: peek bar `{n} item · {estimate}` + button `Lihat troli`; sheet/page title `Troli Anda`; empty state `Troli kosong — jom pilih ayam segar`; CTA `Teruskan ke checkout`; totals row label `Anggaran jumlah` with a `?` button (aria-label `Kenapa harga anggaran?`).

- [ ] **Step 1: Cart UI context**

Create `src/features/buyer/components/cart-ui-context.tsx`:

```tsx
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
```

- [ ] **Step 2: CartView**

Create `src/features/buyer/components/cart-view.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bird, Minus, Plus, Trash2 } from "lucide-react";
import { useCart } from "./cart-context";
import { ScaleChip } from "./scale-chip";
import { PricingExplainerSheet } from "./pricing-explainer-sheet";
import {
  BUYER_FALLBACK_LABELS,
  cartEstimate,
  estimateRange,
  formatEstimate,
} from "@/features/buyer/lib/price-estimate";

export function CartView({
  organizationSlug,
  onNavigate,
}: {
  organizationSlug: string;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const { items, updateLine, removeLine } = useCart();
  const [explainerOpen, setExplainerOpen] = useState(false);
  const total = cartEstimate(items);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <Bird className="mb-4 h-14 w-14 text-muted-foreground/50" strokeWidth={1.25} />
        <p className="font-buyer-display text-xl font-semibold">Troli kosong — jom pilih ayam segar</p>
        <button
          type="button"
          className="mt-6 rounded-full bg-primary px-6 py-2.5 font-medium text-primary-foreground transition-transform active:scale-[0.97]"
          onClick={() => {
            onNavigate?.();
            router.push(`/buyer_portal/${organizationSlug}/shop`);
          }}
        >
          Lihat produk
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-4">
        {items.map((item, index) => {
          const step = item.mode === "kg" ? 0.1 : 1;
          const min = item.mode === "kg" ? 0.1 : 1;
          const lineEstimate =
            item.pricePerUnit !== undefined && item.unitType !== undefined
              ? estimateRange({
                  mode: item.mode,
                  quantity: item.quantity,
                  sizeMinKg: item.sizeMinKg,
                  sizeMaxKg: item.sizeMaxKg,
                  pricePerUnit: item.pricePerUnit,
                  unitType: item.unitType,
                })
              : null;
          return (
            <li key={`${item.productId}-${index}`} className="flex items-start gap-3 border-b border-dashed pb-4 last:border-0 last:pb-0">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary">
                <Bird className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{item.productName}</p>
                <p className="text-sm text-muted-foreground">
                  {item.sizeMinKg}–{item.sizeMaxKg} kg/ekor · {BUYER_FALLBACK_LABELS[item.fallback]}
                </p>
                <ScaleChip estimate={lineEstimate} className="mt-1" />
              </div>
              <div className="flex items-center gap-1">
                <button type="button" aria-label="Kurang" className="flex h-11 w-11 items-center justify-center rounded-full border transition-transform active:scale-95"
                  onClick={() => updateLine(index, { quantity: Math.max(min, Math.round((item.quantity - step) * 1000) / 1000) })}>
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-14 text-center font-buyer-mono text-sm">
                  {item.mode === "kg" ? `${item.quantity} kg` : item.quantity}
                </span>
                <button type="button" aria-label="Tambah kuantiti" className="flex h-11 w-11 items-center justify-center rounded-full border transition-transform active:scale-95"
                  onClick={() => updateLine(index, { quantity: Math.round((item.quantity + step) * 1000) / 1000 })}>
                  <Plus className="h-4 w-4" />
                </button>
                <button type="button" aria-label="Buang" className="ml-1 flex h-11 w-11 items-center justify-center rounded-full text-[color:var(--buyer-delta)] transition-transform active:scale-95"
                  onClick={() => removeLine(index)}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between border-t pt-4">
        <div>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            Anggaran jumlah
            <button type="button" aria-label="Kenapa harga anggaran?" className="underline decoration-dotted"
              onClick={() => setExplainerOpen(true)}>
              ?
            </button>
          </p>
          <p className="font-buyer-mono text-xl font-medium">
            {total ? formatEstimate(total) : "—"}
          </p>
        </div>
        <button
          type="button"
          className="rounded-full bg-primary px-6 py-3 font-medium text-primary-foreground transition-transform active:scale-[0.97]"
          onClick={() => {
            onNavigate?.();
            router.push(`/buyer_portal/${organizationSlug}/checkout`);
          }}
        >
          Teruskan ke checkout
        </button>
      </div>

      <PricingExplainerSheet open={explainerOpen} onOpenChange={setExplainerOpen} />
    </div>
  );
}
```

- [ ] **Step 3: CartOverlay (peek bar + sheet)**

Create `src/features/buyer/components/cart-overlay.tsx`:

```tsx
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
    pathname.endsWith("/cart") || pathname.includes("/checkout") || pathname.includes("/login");
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
```

- [ ] **Step 4: Mount in layout, wire header**

In `src/app/buyer_portal/[organizationSlug]/layout.tsx`, wrap children and mount the overlay (inside `CartProvider`):

```tsx
import { CartUiProvider } from "@/features/buyer/components/cart-ui-context";
import { CartOverlay } from "@/features/buyer/components/cart-overlay";
```

```tsx
      <CartProvider>
        <CartUiProvider>
          <div className={`buyer-theme min-h-screen ${fraunces.variable} ${schibsted.variable} ${plexMono.variable}`}>
            <BuyerHeader ... />
            <main ...>{children}</main>
            <CartOverlay organizationSlug={organizationSlug} />
          </div>
        </CartUiProvider>
      </CartProvider>
```

In `src/features/buyer/components/buyer-header.tsx`, replace the cart Link button (lines 100-106) with a sheet trigger showing a count badge:

```tsx
import { useCart } from "./cart-context";
import { useCartUi } from "./cart-ui-context";
```

(inside the component body:)

```tsx
  const { items } = useCart();
  const { openCart } = useCartUi();
```

```tsx
          <Button variant="ghost" size="icon" onClick={openCart} className="relative">
            <ShoppingCart className="h-5 w-5" />
            {items.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-buyer-mono text-[10px] font-medium text-primary-foreground">
                {items.length}
              </span>
            )}
            <span className="sr-only">Troli</span>
          </Button>
```

- [ ] **Step 5: Rewrite /cart page on CartView**

Replace `src/app/buyer_portal/[organizationSlug]/cart/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { CartView } from "@/features/buyer/components/cart-view";

type CartPageProps = { params: Promise<{ organizationSlug: string }> };

export default function CartPage({ params }: CartPageProps) {
  const [organizationSlug, setOrganizationSlug] = useState("");
  useEffect(() => {
    params.then((p) => setOrganizationSlug(p.organizationSlug));
  }, [params]);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-buyer-display mb-8 text-3xl font-bold">Troli Anda</h1>
      {organizationSlug && <CartView organizationSlug={organizationSlug} />}
    </div>
  );
}
```

- [ ] **Step 6: Gates + visual**

Run: `npm run typecheck && npm run lint && npm test`. Dev server: adding a product pops the peek bar with the estimate; tapping it opens the cart sheet; drag down dismisses; header badge counts; `/cart` renders the same view as a page.

- [ ] **Step 7: Commit**

```bash
git add src/features/buyer/components 'src/app/buyer_portal/[organizationSlug]/cart/page.tsx' 'src/app/buyer_portal/[organizationSlug]/layout.tsx'
git commit -m "feat(buyer): peeking cart bar, cart sheet, shared cart view, header badge"
```

---

### Task 9: Checkout — CTA state machine (TDD), inline account section, rebuilt one-screen client

**Files:**
- Create: `src/features/buyer/lib/checkout-cta.ts`
- Create: `src/features/buyer/tests/unit/checkout-cta.test.ts`
- Create: `src/app/buyer_portal/[organizationSlug]/checkout/account-section.tsx`
- Modify: `src/app/buyer_portal/[organizationSlug]/checkout/page.tsx` (drop guard, pass session buyer)
- Rewrite: `src/app/buyer_portal/[organizationSlug]/checkout/checkout-client.tsx`

**Interfaces:**
- Consumes: `buyerSignUpAction`, `buyerSignInAction`, `getBuyerFromSession` (`src/lib/auth/buyer-auth.ts:109`), `listMyAddresses`, `createAddress`, `getActiveZones`, `getDeliveryOptions`, `resolveZoneForPostcode`, `placeOrder`, `AddressFields`, `useCart`, `cartEstimate`, `formatEstimate`, `ScaleChip` (Task 3), `useToast`.
- Produces:
  - `checkoutStage(i: StageInput): CheckoutStage` and `STAGE_CTA: Record<CheckoutStage, string>` where `type CheckoutStage = "account" | "address" | "slot" | "ready"` and `type StageInput = { isAuthed: boolean; accountValid: boolean; addressValid: boolean; zoneResolved: boolean; slotSelected: boolean }`.
  - `AccountSection` (client component) with props `{ mode: "signup" | "signin"; onModeChange: (m: "signup" | "signin") => void; value: AccountValue; onChange: (v: AccountValue) => void; fieldErrors: Record<string, string[]>; disabled: boolean }` and `type AccountValue = { displayName: string; phone: string; email: string; password: string }` (exported from `account-section.tsx`).
  - `CheckoutClient({ organizationSlug, initialBuyer }: { organizationSlug: string; initialBuyer: { displayName: string; phone: string | null } | null })` — Task 10 layers Slot Snap/sticky bar/confirmation onto this file.
- Copy contract: section headings `Akaun anda`, `Alamat penghantaran`, `Slot penghantaran`; account toggle `Akaun baru` / `Sudah ada akaun`; phone helper `Kami akan hantar kemas kini pesanan ke nombor ini.`; zone chip `Zon: {name} ✓`; uncovered `Belum sampai kawasan ini lagi — cuba poskod lain atau hubungi kami.`; notes toggle `+ Tambah nota`; CTA strings in `STAGE_CTA` below; submitting label `Menghantar…`.

- [ ] **Step 1: Write the failing CTA test**

Create `src/features/buyer/tests/unit/checkout-cta.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkoutStage, STAGE_CTA } from "@/features/buyer/lib/checkout-cta";

const base = { isAuthed: false, accountValid: false, addressValid: false, zoneResolved: false, slotSelected: false };

describe("checkoutStage", () => {
  it("anonymous with empty account form → account", () => {
    expect(checkoutStage(base)).toBe("account");
  });
  it("anonymous with valid account fields advances to address", () => {
    expect(checkoutStage({ ...base, accountValid: true })).toBe("address");
  });
  it("signed-in skips account", () => {
    expect(checkoutStage({ ...base, isAuthed: true })).toBe("address");
  });
  it("address valid but zone unresolved stays address", () => {
    expect(checkoutStage({ ...base, isAuthed: true, addressValid: true })).toBe("address");
  });
  it("zone resolved → slot", () => {
    expect(checkoutStage({ ...base, isAuthed: true, addressValid: true, zoneResolved: true })).toBe("slot");
  });
  it("slot selected → ready", () => {
    expect(
      checkoutStage({ ...base, isAuthed: true, addressValid: true, zoneResolved: true, slotSelected: true }),
    ).toBe("ready");
  });
  it("CTA copy per stage", () => {
    expect(STAGE_CTA.account).toBe("Isi akaun anda");
    expect(STAGE_CTA.address).toBe("Pilih alamat");
    expect(STAGE_CTA.slot).toBe("Pilih slot penghantaran");
    expect(STAGE_CTA.ready).toBe("Hantar pesanan");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/buyer/tests/unit/checkout-cta.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the state machine**

Create `src/features/buyer/lib/checkout-cta.ts`:

```ts
export type CheckoutStage = "account" | "address" | "slot" | "ready";

export type StageInput = {
  isAuthed: boolean;
  accountValid: boolean;
  addressValid: boolean;
  zoneResolved: boolean;
  slotSelected: boolean;
};

/** The narrating CTA: the button label always names the NEXT thing needed. */
export function checkoutStage(i: StageInput): CheckoutStage {
  if (!i.isAuthed && !i.accountValid) return "account";
  if (!i.addressValid || !i.zoneResolved) return "address";
  if (!i.slotSelected) return "slot";
  return "ready";
}

export const STAGE_CTA: Record<CheckoutStage, string> = {
  account: "Isi akaun anda",
  address: "Pilih alamat",
  slot: "Pilih slot penghantaran",
  ready: "Hantar pesanan",
};
```

Run: `npx vitest run src/features/buyer/tests/unit/checkout-cta.test.ts`
Expected: PASS.

- [ ] **Step 4: AccountSection component**

Create `src/app/buyer_portal/[organizationSlug]/checkout/account-section.tsx`:

```tsx
"use client";

import { motion } from "motion/react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type AccountValue = {
  displayName: string;
  phone: string;
  email: string;
  password: string;
};

type AccountSectionProps = {
  mode: "signup" | "signin";
  onModeChange: (m: "signup" | "signin") => void;
  value: AccountValue;
  onChange: (v: AccountValue) => void;
  fieldErrors: Record<string, string[]>;
  disabled: boolean;
};

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <p className="text-sm" style={{ color: "var(--buyer-delta)" }}>{errors[0]}</p>;
}

export function AccountSection({ mode, onModeChange, value, onChange, fieldErrors, disabled }: AccountSectionProps) {
  const set = (patch: Partial<AccountValue>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-4">
      <div className="relative grid grid-cols-2 rounded-full bg-secondary p-1" role="radiogroup" aria-label="Akaun">
        {([["signup", "Akaun baru"], ["signin", "Sudah ada akaun"]] as const).map(([m, label]) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} disabled={disabled}
            onClick={() => onModeChange(m)} className="relative z-10 rounded-full py-2 text-sm font-medium">
            {mode === m && (
              <motion.span layoutId="account-mode-pill"
                className="absolute inset-0 -z-10 rounded-full bg-card shadow-sm"
                transition={{ type: "spring", bounce: 0, duration: 0.3 }} />
            )}
            {label}
          </button>
        ))}
      </div>

      {mode === "signup" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="acc-name">Nama</Label>
            <Input id="acc-name" autoComplete="name" value={value.displayName}
              onChange={(e) => set({ displayName: e.target.value })} disabled={disabled} className="h-11" />
            <FieldError errors={fieldErrors.displayName} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc-phone">Nombor telefon</Label>
            <Input id="acc-phone" type="tel" inputMode="tel" placeholder="012-345 6789" autoComplete="tel"
              value={value.phone} onChange={(e) => set({ phone: e.target.value })} disabled={disabled} className="h-11" />
            <p className="text-xs text-muted-foreground">Kami akan hantar kemas kini pesanan ke nombor ini.</p>
            <FieldError errors={fieldErrors.phone} />
          </div>
        </>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="acc-email">Email</Label>
        <Input id="acc-email" type="email" autoComplete="email" value={value.email}
          onChange={(e) => set({ email: e.target.value })} disabled={disabled} className="h-11" />
        <FieldError errors={fieldErrors.email} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="acc-password">Kata laluan {mode === "signup" ? "(min 8 aksara)" : ""}</Label>
        <Input id="acc-password" type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          minLength={mode === "signup" ? 8 : undefined}
          value={value.password} onChange={(e) => set({ password: e.target.value })} disabled={disabled} className="h-11" />
        <FieldError errors={fieldErrors.password} />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Drop the guard in page.tsx**

Replace `src/app/buyer_portal/[organizationSlug]/checkout/page.tsx`:

```tsx
import { getBuyerFromSession } from "@/lib/auth/buyer-auth";
import CheckoutClient from "./checkout-client";

type CheckoutPageProps = {
  params: Promise<{ organizationSlug: string }>;
};

export default async function CheckoutPage({ params }: CheckoutPageProps) {
  const { organizationSlug } = await params;
  // No redirect wall: anonymous buyers create their account inside checkout.
  const buyer = await getBuyerFromSession();
  return (
    <CheckoutClient
      organizationSlug={organizationSlug}
      initialBuyer={buyer ? { displayName: buyer.display_name, phone: buyer.phone } : null}
    />
  );
}
```

- [ ] **Step 6: Rebuild checkout-client.tsx**

Replace `src/app/buyer_portal/[organizationSlug]/checkout/checkout-client.tsx` in full. Structure and behavior to implement (keep the existing zone/options effects verbatim where noted):

```tsx
"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Loader2, MapPin, CheckCircle2 } from "lucide-react";
import { useCart } from "@/features/buyer/components/cart-context";
import {
  getActiveZones,
  getDeliveryOptions,
  placeOrder,
  resolveZoneForPostcode,
} from "@/features/orders/server/portal-actions";
import type { DeliveryOption } from "@/features/orders/types";
import { listMyAddresses, createAddress } from "@/features/buyer/server/address-actions";
import type { BuyerAddress } from "@/features/buyer/types";
import { AddressFields, type AddressValue } from "@/features/buyer/components/address-fields";
import { buyerSignInAction, buyerSignUpAction } from "@/features/buyer-auth/server/auth-actions";
import { AccountSection, type AccountValue } from "./account-section";
import { checkoutStage, STAGE_CTA } from "@/features/buyer/lib/checkout-cta";
import { cartEstimate, formatEstimate } from "@/features/buyer/lib/price-estimate";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type CheckoutClientProps = {
  organizationSlug: string;
  initialBuyer: { displayName: string; phone: string | null } | null;
};

function optionKey(option: DeliveryOption) {
  return `${option.date}-${option.slotId}`;
}

export default function CheckoutClient({ organizationSlug, initialBuyer }: CheckoutClientProps) {
  const router = useRouter();
  const { items, clearCart } = useCart();
  const { toast } = useToast();

  // --- account (anonymous only) ---
  const [buyer, setBuyer] = useState(initialBuyer);
  const [accountMode, setAccountMode] = useState<"signup" | "signin">("signup");
  const [account, setAccount] = useState<AccountValue>({ displayName: "", phone: "", email: "", password: "" });
  const [accountErrors, setAccountErrors] = useState<Record<string, string[]>>({});

  // --- address + zone (same machine as before) ---
  const [savedAddresses, setSavedAddresses] = useState<BuyerAddress[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(initialBuyer !== null);
  const [selectedAddressId, setSelectedAddressId] = useState<string>("new");
  const [newAddress, setNewAddress] = useState<AddressValue>({ addressLine: "", postcode: "", state: "", area: "" });
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [zoneState, setZoneState] = useState<"idle" | "resolving" | "resolved" | "uncovered">("idle");
  const [zoneNames, setZoneNames] = useState<Record<string, string>>({});

  // --- slots / notes / submit ---
  const [options, setOptions] = useState<DeliveryOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [orderComplete, setOrderComplete] = useState(false);
  const [orderId, setOrderId] = useState<string>("");

  // Saved addresses only exist for signed-in buyers.
  useEffect(() => {
    if (!buyer) return;
    let cancelled = false;
    setAddressesLoading(true);
    listMyAddresses()
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setSavedAddresses(result.data);
          const preferred = result.data.find((a) => a.isDefault) ?? result.data[0];
          if (preferred) setSelectedAddressId(preferred.id);
        }
        setAddressesLoading(false);
      })
      .catch(() => !cancelled && setAddressesLoading(false));
    return () => { cancelled = true; };
  }, [buyer]);

  // Zone names for the confirmed chip.
  useEffect(() => {
    let cancelled = false;
    getActiveZones(organizationSlug).then((result) => {
      if (cancelled || !result.ok) return;
      setZoneNames(Object.fromEntries(result.data.map((z) => [z.id, z.name])));
    });
    return () => { cancelled = true; };
  }, [organizationSlug]);

  const activeAddress: AddressValue | null = useMemo(() => {
    if (selectedAddressId !== "new") {
      const saved = savedAddresses.find((a) => a.id === selectedAddressId);
      return saved
        ? { addressLine: saved.addressLine, postcode: saved.postcode, state: saved.state, area: saved.area }
        : null;
    }
    return newAddress;
  }, [selectedAddressId, savedAddresses, newAddress]);

  // (Zone resolve effect: copy VERBATIM from the previous checkout-client.tsx
  //  lines 100-132 — postcode regex, resolving state, uncovered fallback.)

  // (Options fetch effect: copy VERBATIM from previous lines 134-152.)

  const groupedOptions = useMemo(() => {
    const groups = new Map<string, DeliveryOption[]>();
    for (const option of options) {
      const list = groups.get(option.date) ?? [];
      list.push(option);
      groups.set(option.date, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [options]);

  const selectedOption = options.find((o) => optionKey(o) === selectedKey) ?? null;
  const estimate = cartEstimate(items);

  const accountValid =
    accountMode === "signup"
      ? account.displayName.trim().length > 0 && account.phone.trim().length > 0 &&
        /\S+@\S+\.\S+/.test(account.email) && account.password.length >= 8
      : /\S+@\S+\.\S+/.test(account.email) && account.password.length > 0;

  const addressValid =
    activeAddress !== null &&
    activeAddress.addressLine.trim().length > 0 &&
    /^[0-9]{5}$/.test(activeAddress.postcode) &&
    activeAddress.state !== "" &&
    activeAddress.area !== "";

  const stage = checkoutStage({
    isAuthed: buyer !== null,
    accountValid,
    addressValid,
    zoneResolved: zoneState === "resolved" && zoneId !== null,
    slotSelected: selectedOption !== null,
  });
  const canSubmit = items.length > 0 && stage === "ready" && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !selectedOption || !activeAddress || zoneId === null) return;
    setSubmitting(true);
    setAccountErrors({});

    // 1. Inline account, only when anonymous. The session cookie from the
    //    auth action carries into placeOrder's requireBuyer.
    if (!buyer) {
      const auth =
        accountMode === "signup"
          ? await buyerSignUpAction({
              email: account.email,
              password: account.password,
              displayName: account.displayName,
              phone: account.phone,
              organizationSlug,
            })
          : await buyerSignInAction({
              email: account.email,
              password: account.password,
              organizationSlug,
            });
      if (!auth.ok) {
        setSubmitting(false);
        setAccountErrors(auth.fieldErrors ?? {});
        if (auth.code === "conflict") {
          setAccountMode("signin");
          toast({ title: "Email sudah didaftar", description: "Masukkan kata laluan anda untuk teruskan.", });
        } else {
          toast({ title: "Akaun gagal", description: auth.message, variant: "destructive" });
        }
        return;
      }
      setBuyer({ displayName: account.displayName || "Buyer", phone: account.phone || null });
    }

    // 2. Place the order (unchanged action).
    const composedAddress = `${activeAddress.addressLine.trim()}, ${activeAddress.postcode} ${activeAddress.area}, ${activeAddress.state}`;
    const result = await placeOrder({
      organizationSlug,
      zoneId,
      slotId: selectedOption.slotId,
      deliveryDate: selectedOption.date,
      address: composedAddress,
      postcode: activeAddress.postcode,
      notes: notes.trim() || undefined,
      items: items.map((item) => ({
        productId: item.productId,
        mode: item.mode,
        quantity: item.quantity,
        sizeMinKg: item.sizeMinKg,
        sizeMaxKg: item.sizeMaxKg,
        fallback: item.fallback,
      })),
    });
    setSubmitting(false);

    if (!result.ok) {
      toast({ title: "Pesanan gagal", description: result.message, variant: "destructive" });
      return;
    }

    if (selectedAddressId === "new") {
      createAddress({
        addressLine: newAddress.addressLine.trim(),
        postcode: newAddress.postcode,
        state: newAddress.state,
        area: newAddress.area,
      }).catch(() => {});
    }

    setOrderId(result.data.orderId);
    setOrderComplete(true);
    clearCart();
  };

  // ... render (Step 7 below)
}
```

- [ ] **Step 7: Render tree for the same file**

Render, in order (all inside one `<form onSubmit={handleSubmit}>`, single column `max-w-2xl mx-auto space-y-6 pb-32`):

1. `<h1 className="font-buyer-display text-3xl font-bold">Checkout</h1>`
2. **Akaun anda** section — only when `buyer === null`: bordered card `rounded-2xl border bg-card p-5` with `<h2 className="font-buyer-display text-xl font-semibold">Akaun anda</h2>` then `<AccountSection mode={accountMode} onModeChange={setAccountMode} value={account} onChange={setAccount} fieldErrors={accountErrors} disabled={submitting} />`. When `buyer !== null` render one line: `Log masuk sebagai {buyer.displayName}`.
3. **Alamat penghantaran** card — saved-address radio buttons (keep the existing markup from old lines 305-350, restyled classes only), `AddressFields` for "new", then the zone status row:
   - resolving: `<Loader2 className="h-4 w-4 animate-spin" /> Menyemak kawasan…`
   - resolved: `<span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium" style={{ backgroundColor: "color-mix(in oklab, var(--buyer-confirmed) 15%, transparent)", color: "var(--buyer-confirmed)" }}><MapPin className="h-3.5 w-3.5" />Zon: {zoneNames[zoneId ?? ""] ?? "Disahkan"} ✓</span>`
   - uncovered: warm card `rounded-2xl bg-secondary p-4 text-sm` with `Belum sampai kawasan ini lagi — cuba poskod lain atau hubungi kami.`
4. **Slot penghantaran** card — for Task 9 keep the existing grouped radio grid (old lines 397-437) with BM date format `format(new Date(...), "EEEE, d MMM")` and remaining copy `{option.remaining} slot tersisa`. (Task 10 replaces this block with the date-pill rail + Slot Snap.)
5. **Nota** — `<button type="button" onClick={() => setNotesOpen(!notesOpen)} className="text-sm text-muted-foreground underline decoration-dotted">+ Tambah nota</button>` revealing a `Textarea` when open.
6. **Submit row** (Task 9 version; Task 10 turns it into the sticky bar): full-width primary button, label `{submitting ? "Menghantar…" : STAGE_CTA[stage]}`, `disabled={!canSubmit}`, `className="w-full rounded-full bg-primary py-4 text-lg font-medium text-primary-foreground transition-transform active:scale-[0.97] disabled:opacity-50"`, with the estimate line above it: `Anggaran: {estimate ? formatEstimate(estimate) : "—"}` in `font-buyer-mono`.
7. **Empty cart branch** (before the form): copy `Troli kosong — jom pilih ayam segar` + `Lihat produk` button linking to shop.
8. **orderComplete branch** (Task 9 placeholder, replaced in Task 10): keep a minimal card with `<CheckCircle2 />`, `Pesanan diterima!`, order id `#{orderId.slice(0, 8)}`, and a `Lihat pesanan saya` button pushing to `/buyer_portal/${organizationSlug}/orders`.

- [ ] **Step 8: Gates + tests + manual pass**

Run: `npm run typecheck && npm run lint && npm test`
Expected: clean; CTA tests pass. Manual (dev server, logged OUT, cart filled): checkout renders with Akaun anda first, CTA narrates stages as you fill, submitting creates the account then the order; `conflict` email flips to Sudah ada akaun. Logged in: no account section, saved addresses load.

- [ ] **Step 9: Commit**

```bash
git add src/features/buyer/lib/checkout-cta.ts src/features/buyer/tests/unit/checkout-cta.test.ts 'src/app/buyer_portal/[organizationSlug]/checkout'
git commit -m "feat(buyer): one-screen checkout with inline account creation, narrating CTA"
```

---

### Task 10: Checkout part 2 — slot rail + Slot Snap, sticky bar, confirmation takeover

**Files:**
- Modify: `src/app/buyer_portal/[organizationSlug]/checkout/checkout-client.tsx`
- Create: `src/features/buyer/components/order-tracker.tsx` (+ mapping lib in Task 11 Step 1 — the component here imports it, so do Task 11 Step 1-3 first if executing out of order; in-order execution is fine because Task 11's lib lands there. To keep tasks independent, the tracker COMPONENT is created in Task 11 and the confirmation here uses a static 3-step list.)

**Interfaces:**
- Consumes: Task 9's rebuilt client, `motion/react` (`AnimatePresence`, `motion`, `useReducedMotion`).
- Produces: final checkout UX; confirmation takeover markup with `data-testid="order-confirmation"`.
- Copy contract: slot pill day format `EEE d MMM` (e.g. `Rab 26 Ogo` under ms locale is NOT used — keep date-fns default English day short-names to avoid a locale dep; the e2e matches on `data-testid` and button roles, not day names); confirmed slot pill `{HH:mm}–{HH:mm} ✓`; confirmation heading `Pesanan diterima!`; sub `No. pesanan #{first8}`; buttons `Lihat pesanan saya`, `Terus beli lagi`; tracker steps `Ditempah`, `Dihantar`, `Harga disahkan`.

- [ ] **Step 1: Replace the slot section with the date-pill rail + Slot Snap**

In the rebuilt `checkout-client.tsx`, swap the Task 9 slot block for:

```tsx
{/* Slot penghantaran */}
<section className="rounded-2xl border bg-card p-5">
  <h2 className="font-buyer-display mb-1 text-xl font-semibold">Slot penghantaran</h2>
  <p className="mb-4 text-sm text-muted-foreground">
    {zoneId === null ? "Isi alamat dulu untuk lihat slot." : "Pilih tarikh dan masa."}
  </p>

  <AnimatePresence mode="popLayout" initial={false}>
    {selectedOption ? (
      <motion.button
        key="picked"
        type="button"
        layout
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0 }}
        transition={{ type: "spring", bounce: 0, duration: 0.35 }}
        onClick={() => setSelectedKey("")}
        className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium"
        style={{
          backgroundColor: "color-mix(in oklab, var(--buyer-confirmed) 15%, transparent)",
          color: "var(--buyer-confirmed)",
        }}
      >
        {format(new Date(`${selectedOption.date}T00:00:00`), "EEE d MMM")} ·{" "}
        {selectedOption.startTime.slice(0, 5)}–{selectedOption.endTime.slice(0, 5)} ✓
      </motion.button>
    ) : (
      <motion.div key="picker" layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        {optionsLoading && zoneId !== null && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuatkan slot…
          </p>
        )}
        {!optionsLoading && zoneId !== null && groupedOptions.length === 0 && (
          <p className="text-sm text-muted-foreground">Tiada slot untuk kawasan ini lagi.</p>
        )}
        {!optionsLoading && groupedOptions.length > 0 && (
          <div className="space-y-3">
            <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] snap-x" role="radiogroup" aria-label="Tarikh">
              {groupedOptions.map(([date]) => (
                <button key={date} type="button" role="radio" aria-checked={date === activeDate}
                  onClick={() => setActiveDate(date)}
                  className={`shrink-0 snap-start rounded-full border px-4 py-1.5 text-sm transition-transform active:scale-95 ${
                    date === activeDate ? "border-foreground bg-foreground font-medium text-background" : "border-border"
                  }`}>
                  {format(new Date(`${date}T00:00:00`), "EEE d MMM")}
                </button>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Masa">
              {(groupedOptions.find(([d]) => d === activeDate)?.[1] ?? []).map((option) => (
                <button key={optionKey(option)} type="button" role="radio" aria-checked={false}
                  onClick={() => setSelectedKey(optionKey(option))}
                  className="rounded-2xl border p-3 text-left text-sm transition-transform active:scale-[0.97]">
                  <p className="font-medium">{option.startTime.slice(0, 5)}–{option.endTime.slice(0, 5)}</p>
                  <p className="text-muted-foreground">{option.truckName}</p>
                  {option.remaining !== null && (
                    <p className="mt-1 text-xs text-muted-foreground">{option.remaining} slot tersisa</p>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </motion.div>
    )}
  </AnimatePresence>
</section>
```

Add the supporting state near the other slot state: `const [activeDate, setActiveDate] = useState<string>("");` plus an effect defaulting it to the first group whenever `groupedOptions` changes and `activeDate` is not among them.

- [ ] **Step 2: Sticky bottom bar**

Replace the Task 9 submit row with a fixed bar (inside the form, after the sections):

```tsx
<div className="fixed inset-x-0 bottom-0 z-50 border-t bg-card/[0.97] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
  <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">Anggaran</p>
      <p className="truncate font-buyer-mono text-lg font-medium">
        {estimate ? formatEstimate(estimate) : "—"}
      </p>
    </div>
    <button type="submit" disabled={!canSubmit}
      className="shrink-0 rounded-full bg-primary px-8 py-3.5 font-medium text-primary-foreground transition-transform active:scale-[0.97] disabled:opacity-50">
      {submitting ? (
        <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Menghantar…</span>
      ) : (
        STAGE_CTA[stage]
      )}
    </button>
  </div>
</div>
```

(The page container already has `pb-32` from Task 9 so content clears the bar.)

- [ ] **Step 3: Confirmation takeover**

Replace the Task 9 `orderComplete` branch:

```tsx
if (orderComplete) {
  return (
    <div data-testid="order-confirmation" className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center text-center">
      <motion.div
        initial={reduced ? { opacity: 0 } : { scale: 0.5, opacity: 0 }}
        animate={reduced ? { opacity: 1 } : { scale: 1, opacity: 1 }}
        transition={reduced ? { duration: 0.2 } : { type: "spring", bounce: 0, duration: 0.5 }}
        className="mb-6 flex h-20 w-20 items-center justify-center rounded-full"
        style={{ backgroundColor: "color-mix(in oklab, var(--buyer-confirmed) 15%, transparent)" }}
      >
        <CheckCircle2 className="h-10 w-10" style={{ color: "var(--buyer-confirmed)" }} />
      </motion.div>
      <h1 className="font-buyer-display text-3xl font-bold">Pesanan diterima!</h1>
      <p className="mt-2 font-buyer-mono text-muted-foreground">No. pesanan #{orderId.slice(0, 8)}</p>
      <p className="mt-4 max-w-sm text-sm text-muted-foreground">
        Kami akan timbang ayam anda dan sahkan harga sebelum penghantaran. Alamat anda
        telah disimpan untuk pesanan akan datang.
      </p>
      <ol className="mt-6 flex items-center gap-3 text-xs text-muted-foreground">
        {["Ditempah", "Dihantar", "Harga disahkan"].map((step, i) => (
          <li key={step} className="flex items-center gap-1.5">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full font-buyer-mono ${i === 0 ? "text-background" : "bg-secondary"}`}
              style={i === 0 ? { backgroundColor: "var(--buyer-confirmed)" } : undefined}
            >
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
      <div className="mt-8 flex w-full flex-col gap-2">
        <button type="button" onClick={() => router.push(`/buyer_portal/${organizationSlug}/orders`)}
          className="w-full rounded-full bg-primary py-3 font-medium text-primary-foreground transition-transform active:scale-[0.97]">
          Lihat pesanan saya
        </button>
        <button type="button" onClick={() => router.push(`/buyer_portal/${organizationSlug}/shop`)}
          className="w-full rounded-full border py-3 font-medium transition-transform active:scale-[0.97]">
          Terus beli lagi
        </button>
      </div>
    </div>
  );
}
```

Add `const reduced = useReducedMotion();` and the motion imports:
`import { AnimatePresence, motion, useReducedMotion } from "motion/react";`

- [ ] **Step 4: Gates + manual**

Run: `npm run typecheck && npm run lint && npm test`. Manual: picking a slot contracts the picker into the green pill (tap reopens); sticky bar narrates; submit shows the takeover with the spring check.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/buyer_portal/[organizationSlug]/checkout/checkout-client.tsx'
git commit -m "feat(buyer): slot snap picker, sticky checkout bar, confirmation takeover"
```

---

### Task 11: Order tracker (TDD) + orders list/detail reskin

**Files:**
- Create: `src/features/buyer/lib/order-tracker.ts`
- Create: `src/features/buyer/tests/unit/order-tracker.test.ts`
- Create: `src/features/buyer/components/order-tracker.tsx`
- Modify: `src/app/buyer_portal/[organizationSlug]/orders/page.tsx`
- Modify: `src/app/buyer_portal/[organizationSlug]/orders/[orderId]/page.tsx`

**Interfaces:**
- Consumes: `OrderStatus` from `@/features/orders/types`; `ScaleChip`, `formatRM`.
- Produces:
  - `TRACKER_STEPS = ["Ditempah", "Dihantar", "Harga disahkan"] as const`
  - `trackerIndex(status: OrderStatus): number | null` — `pending|confirmed|ready → 0`, `delivered → 1`, `closed → 2`, `cancelled → null`
  - `OrderTracker({ status }: { status: OrderStatus })` — horizontal 3-step bar; done/current steps use `--buyer-confirmed`, future steps muted; renders nothing for `cancelled`.

- [ ] **Step 1: Failing test**

Create `src/features/buyer/tests/unit/order-tracker.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TRACKER_STEPS, trackerIndex } from "@/features/buyer/lib/order-tracker";

describe("trackerIndex", () => {
  it.each([
    ["pending", 0], ["confirmed", 0], ["ready", 0],
    ["delivered", 1],
    ["closed", 2],
  ] as const)("%s → %i", (status, expected) => {
    expect(trackerIndex(status)).toBe(expected);
  });
  it("cancelled → null", () => {
    expect(trackerIndex("cancelled")).toBeNull();
  });
  it("has exactly three steps", () => {
    expect(TRACKER_STEPS).toHaveLength(3);
  });
});
```

Run: `npx vitest run src/features/buyer/tests/unit/order-tracker.test.ts` — Expected: FAIL.

- [ ] **Step 2: Implement lib**

Create `src/features/buyer/lib/order-tracker.ts`:

```ts
import type { OrderStatus } from "@/features/orders/types";

export const TRACKER_STEPS = ["Ditempah", "Dihantar", "Harga disahkan"] as const;

/** Buyer-facing lifecycle: weighing/settlement (closed) happens AFTER
 *  delivery in this pipeline, so the price-confirmed step is last. */
export function trackerIndex(status: OrderStatus): number | null {
  switch (status) {
    case "pending":
    case "confirmed":
    case "ready":
      return 0;
    case "delivered":
      return 1;
    case "closed":
      return 2;
    case "cancelled":
      return null;
  }
}
```

Run the test again — Expected: PASS.

- [ ] **Step 3: Tracker component**

Create `src/features/buyer/components/order-tracker.tsx`:

```tsx
import { TRACKER_STEPS, trackerIndex } from "@/features/buyer/lib/order-tracker";
import type { OrderStatus } from "@/features/orders/types";

export function OrderTracker({ status }: { status: OrderStatus }) {
  const current = trackerIndex(status);
  if (current === null) return null;
  return (
    <ol className="flex items-center gap-2" aria-label="Status pesanan">
      {TRACKER_STEPS.map((step, i) => {
        const done = i <= current;
        return (
          <li key={step} className="flex flex-1 flex-col gap-1.5">
            <span
              className="h-1 rounded-full"
              style={{ backgroundColor: done ? "var(--buyer-confirmed)" : "var(--border)" }}
            />
            <span className={`text-xs ${done ? "font-medium" : "text-muted-foreground"}`}>{step}</span>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 4: Orders list reskin**

In `src/app/buyer_portal/[organizationSlug]/orders/page.tsx`:
- Heading → `<h1 className="font-buyer-display text-3xl font-bold">Pesanan Saya</h1>`, sub `Sejarah pesanan anda`.
- Inside each order card, under the header row, add `<OrderTracker status={order.status} />` (import from `@/features/buyer/components/order-tracker`).
- Replace the price block (lines 100-105):

```tsx
                  <div className="text-right">
                    {order.status === "closed" ? (
                      <p className="font-buyer-mono text-lg font-bold">{formatPrice(Number(order.total_amount))}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground">Harga selepas timbang</p>
                    )}
```

- Keep the status badge but for `cancelled` only; for live statuses the tracker carries the state (drop the badge span for non-cancelled: `{order.status === "cancelled" && (<span ...>Cancelled</span>)}`).
- Empty state copy → `Belum ada pesanan` / `Jom mula membeli!`, button `Lihat produk`.

- [ ] **Step 5: Order detail reskin (weighed reveal)**

In `src/app/buyer_portal/[organizationSlug]/orders/[orderId]/page.tsx`:
- Heading → `font-buyer-display`; replace the "Order Status" card content: keep `CancelOrderButton` for pending, render `<OrderTracker status={order.status} />` instead of the badge (badge only for `cancelled`).
- In the items loop, replace the closed-state price block (lines 117-130) with the ScaleChip final state:

```tsx
                    {isClosed && item.final_weight_kg !== null && item.price_per_kg !== null && (
                      <ScaleChip
                        estimate={null}
                        final={{
                          total: Number(item.line_total),
                          weightKg: Number(item.final_weight_kg),
                          pricePerKg: Number(item.price_per_kg),
                        }}
                        className="text-right"
                      />
                    )}
```

(`import { ScaleChip } from "@/features/buyer/components/scale-chip";`)
- The closed total row gains the good-news framing: above the Total row add `<p className="text-sm" style={{ color: "var(--buyer-confirmed)" }}>Ditimbang dan harga disahkan ✓</p>`; Total value in `font-buyer-mono`.

- [ ] **Step 6: Gates + tests**

Run: `npm run typecheck && npm run lint && npm test`
Expected: clean, tracker tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/features/buyer/lib/order-tracker.ts src/features/buyer/tests/unit/order-tracker.test.ts src/features/buyer/components/order-tracker.tsx 'src/app/buyer_portal/[organizationSlug]/orders'
git commit -m "feat(buyer): order tracker steps, orders list and weighed-reveal detail reskin"
```

---

### Task 12: Login page restyle

**Files:**
- Modify: `src/app/buyer_portal/[organizationSlug]/login/page.tsx`

**Interfaces:**
- Consumes: existing `buyerSignInAction`/`buyerSignUpAction` handlers — logic unchanged.
- Produces: restyled `/login` kept for returning buyers and old bookmarks.

- [ ] **Step 1: Restyle (markup only — handlers untouched)**

In `login/page.tsx`:
- Card header: title `font-buyer-display text-2xl`, copy stays English-out: change to `Selamat kembali` / `Buat akaun`, descriptions `Log masuk ke akaun pembeli anda` / `Daftar untuk mula membeli`.
- Replace the footer mode-switch buttons with a segmented toggle ABOVE the form (same pattern as `AccountSection`'s radiogroup: two pills `Log masuk` / `Daftar` sharing a `motion.span layoutId="login-mode-pill"`; import `motion` from `motion/react`).
- Submit buttons → `rounded-full bg-primary py-3 font-medium text-primary-foreground transition-transform active:scale-[0.97] w-full`; loading labels `Log masuk…` / `Mendaftar…`.
- Keep `Continue shopping without account` link, copy → `Teruskan beli tanpa akaun` (still valid: shop/cart are public; checkout will create the account inline).
- Inputs `className="h-11"`; phone field keeps helper `Kami akan hantar kemas kini pesanan ke nombor ini.`

- [ ] **Step 2: Gates + visual**

Run: `npm run typecheck && npm run lint`. Visual: /login renders the cream card with segmented toggle; both flows still sign in/up correctly.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/buyer_portal/[organizationSlug]/login/page.tsx'
git commit -m "feat(buyer): login page terus segar restyle, segmented mode toggle"
```

---

### Task 13: E2E — new first-order spec + update existing buyer specs

**Files:**
- Create: `e2e/buyer-inline-signup.spec.ts`
- Modify: `e2e/buyer-order.spec.ts` (new copy/controls)
- Modify: `e2e/buyer-address.spec.ts` (same — mirror the control changes; open the file and update every selector that matches the old add-to-cart dialog, "Proceed to Checkout", "Place Order", "Order Placed!" patterns to the new ones listed below)
- Modify: `e2e/_fixtures.ts` (checkoutWithNewAddress button labels if it clicks any)

**Interfaces:**
- Consumes: fixtures `OWNER`, `BUYER`, `signIn`, `signInBuyer`, `createSellableProduct`, `seedZoneWithCoverage`, `checkoutWithNewAddress`, `uniqueFixtureName` from `e2e/_fixtures.ts`.
- Selector contract (matches Tasks 6-10 copy exactly):
  - card add button: `getByRole("button", { name: "+ Tambah" })`
  - add sheet: `getByRole("dialog")` (BuyerSheet sets `role="dialog"`), mode `getByRole("radio", { name: "Kg" })`, labels `/kuantiti/i`, `/saiz min/i`, `/saiz maks/i`, fallback `getByRole("radio", { name: "Besar pun ok" })`, confirm `getByRole("button", { name: "Tambah ke troli" })`
  - cart: peek bar button `/lihat troli/i` OR direct `goto(...)/cart`; checkout CTA `getByRole("button", { name: "Teruskan ke checkout" })`
  - checkout account: radios `Akaun baru`/`Sudah ada akaun`, labels `Nama`, `Nombor telefon`, `Email`, `/kata laluan/i`
  - slot: date radio group `Tarikh`, time radios under group `Masa`
  - submit: `getByRole("button", { name: "Hantar pesanan" })`
  - confirmation: `getByTestId("order-confirmation")` + text `Pesanan diterima!` + button `/lihat pesanan saya/i`
  - orders heading `Pesanan Saya`

- [ ] **Step 1: New spec — first order with inline signup**

Create `e2e/buyer-inline-signup.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import {
  OWNER,
  createSellableProduct,
  seedZoneWithCoverage,
  signIn,
  uniqueFixtureName,
} from "./_fixtures";

test("first-time buyer orders end-to-end with inline account creation, never seeing /login", async ({
  page,
  context,
}) => {
  const productName = uniqueFixtureName("E2E Inline Signup Chicken");
  await signIn(page, OWNER.email, OWNER.password);
  await createSellableProduct(page, productName);
  await seedZoneWithCoverage(
    page,
    uniqueFixtureName("E2E Inline Zone"),
    uniqueFixtureName("E2E Inline Truck"),
    uniqueFixtureName("TRK").slice(0, 20),
  );

  // Fresh anonymous context page — no buyer session.
  const buyerPage = await context.newPage();
  await buyerPage.goto("/buyer_portal/ayam-norliza-pilot/shop");

  // Dismiss the first-visit pricing explainer if it opens.
  const explainer = buyerPage.getByRole("button", { name: "Faham!" });
  if (await explainer.isVisible({ timeout: 3000 }).catch(() => false)) {
    await explainer.click();
  }

  const productCard = buyerPage
    .locator('[data-slot="card"]')
    .filter({ hasText: productName });
  await expect(productCard).toBeVisible({ timeout: 10_000 });
  await productCard.getByRole("button", { name: "+ Tambah" }).click();

  const sheet = buyerPage.getByRole("dialog");
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  await sheet.getByRole("button", { name: "Tambah ke troli" }).click();
  await expect(sheet).toBeHidden({ timeout: 10_000 });

  await buyerPage.goto("/buyer_portal/ayam-norliza-pilot/cart");
  await expect(buyerPage.getByText(productName)).toBeVisible({ timeout: 10_000 });
  await buyerPage.getByRole("button", { name: "Teruskan ke checkout" }).click();
  await expect(buyerPage).toHaveURL(/\/checkout/, { timeout: 10_000 });
  // The wall is gone: we are on checkout, not /login.
  expect(buyerPage.url()).not.toContain("/login");

  // Inline account (Akaun baru is the default mode).
  const email = `e2e-inline-${Date.now()}@example.com`;
  await buyerPage.getByLabel("Nama").fill("E2E Pembeli Baru");
  await buyerPage.getByLabel("Nombor telefon").fill("012-345 6789");
  await buyerPage.getByLabel("Email").fill(email);
  await buyerPage.getByLabel(/kata laluan/i).fill("passw0rd-e2e");

  // New address (postcode 50000 is covered by the seeded zone).
  await buyerPage.getByLabel(/address line/i).fill("88 Jalan Inline");
  await buyerPage.getByLabel(/postcode/i).fill("50000");
  // AddressFields auto-fills state/area from the postcode.

  // Zone chip confirms, then pick the first available slot.
  await expect(buyerPage.getByText(/zon:/i)).toBeVisible({ timeout: 10_000 });
  const dateGroup = buyerPage.getByRole("radiogroup", { name: "Tarikh" });
  await expect(dateGroup).toBeVisible({ timeout: 10_000 });
  const timeGroup = buyerPage.getByRole("radiogroup", { name: "Masa" });
  await timeGroup.getByRole("radio").first().click();

  await buyerPage.getByRole("button", { name: "Hantar pesanan" }).click();

  await expect(buyerPage.getByTestId("order-confirmation")).toBeVisible({ timeout: 15_000 });
  await expect(buyerPage.getByText("Pesanan diterima!")).toBeVisible();
  await buyerPage.getByRole("button", { name: /lihat pesanan saya/i }).click();
  await expect(buyerPage).toHaveURL(/\/orders/, { timeout: 10_000 });
  await expect(buyerPage.getByText("Pesanan Saya")).toBeVisible({ timeout: 10_000 });
});
```

NOTE for the implementer: open `e2e/_fixtures.ts:306` (`checkoutWithNewAddress`) and `e2e/buyer-address.spec.ts` first and mirror the real `AddressFields` labels used there (the fill calls above must match the actual label text, e.g. "Address line" vs "Alamat"); `AddressFields` is unchanged by this plan, so reuse whatever selectors the existing specs use for it.

- [ ] **Step 2: Update `e2e/buyer-order.spec.ts` to the new controls**

Apply the selector contract above: `+ Tambah` (was `/add to cart/i`), mode radio `Kg` (was a plain button), `Tambah ke troli` (was `Add to cart`), `Teruskan ke checkout` (was `/proceed to checkout/i`), `Hantar pesanan` (was `/place order/i`), confirmation via `getByTestId("order-confirmation")` + `Pesanan diterima!` (was `Order Placed!`), orders assertion: the list no longer shows a "Pending" badge for live orders — assert `getByText("Ditempah").first()` is visible instead. The fallback select is now a radio: replace the Select interaction with `sheet.getByRole("radio", { name: "Besar pun ok" }).click()`.

- [ ] **Step 3: Update `e2e/buyer-address.spec.ts` + fixtures the same way**

Grep the file for `Add to Cart`, `Proceed to Checkout`, `Place Order`, `Order Placed!` and replace with the new labels. In `e2e/_fixtures.ts`, if `checkoutWithNewAddress` clicks slot radios, scope them to the `Masa` radiogroup.

- [ ] **Step 4: Run the buyer e2e**

Run: `npx supabase start && npm run dev` (background) then
`npx playwright test e2e/buyer-inline-signup.spec.ts e2e/buyer-order.spec.ts e2e/buyer-address.spec.ts`
Expected: PASS. Fix selector drift by adjusting the specs to the shipped copy — never by changing shipped copy to match stale specs.

- [ ] **Step 5: Commit**

```bash
git add e2e
git commit -m "test(buyer): inline-signup checkout e2e, update buyer specs to terus segar copy"
```

---

### Task 14: Full gates + visual QA + wrap-up

**Files:** none new.

- [ ] **Step 1: Full local gates**

Run: `npm run typecheck && npm run lint && npm test && npm run test:e2e`
Expected: all green. (`npm run db:test` not needed — no SQL changed.)

- [ ] **Step 2: Visual QA matrix**

Dev server checks:
- 375px, 768px, 1280px: shop, cart (sheet + page), checkout (anon + signed-in), confirmation, orders list/detail, login.
- Root theme dark (toggle the app to dark): buyer pages stay cream.
- `prefers-reduced-motion: reduce` (devtools emulation): sheets fade instead of slide, no springs.
- Keyboard: sheet closes on Esc; radios reachable by Tab.

- [ ] **Step 3: Update the design spec's verification note if anything drifted**

If any copy/control changed during implementation, reconcile `docs/superpowers/specs/2026-08-23-terus-segar-buy-flow-design.md` in the same commit.

- [ ] **Step 4: Final commit + hand back**

```bash
git add -A
git commit -m "chore(buyer): terus segar buy-flow QA pass"
```

Then follow superpowers:finishing-a-development-branch (merge to main deliberately; deploy pre-checks from the spec — hosted Supabase signups enabled + email confirmation off — belong in the merge/deploy checklist, not this branch).

---

## Self-Review

- **Spec coverage:** theme/tokens/fonts (T1), ScaleChip + estimate math (T2-3), explainer taught-once (T5), add-sheet with 0.1kg steps + fallback cards (T6), shop hero/rail/one-ⓘ (T7), peek bar + cart sheet + page (T8), inline account + narrating CTA + zone chip + uncovered card (T9), slot snap + sticky bar + confirmation takeover (T10), tracker + weighed reveal (T11), login restyle (T12), e2e (T13), gates (T14). Desktop right-rail cart from the spec is deliberately NOT built — the sheet + /cart page cover desktop; noted as acceptable simplification (spec's responsive intent is met by the persistent header badge + sheet). If Hafiz wants the rail, it's a follow-up.
- **Placeholder scan:** two intentional "copy VERBATIM from previous lines" directives in T9 Step 6 reference exact line ranges of the file being replaced (the effects are unchanged logic, present in the repo at those lines); all other steps carry full code.
- **Type consistency:** `CartLine.pricePerUnit`/`unitType` optional everywhere; `ScaleChip` props match T3 in T6/T8/T11 usage; `checkoutStage` input names match T9 usage; `AccountValue` shape consistent; tracker `TRACKER_STEPS`/`trackerIndex` match component and confirmation copy (`Ditempah`/`Dihantar`/`Harga disahkan`).
