# Confirm-Step Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seller enters per-line RM/kg price at order confirm; product list prices removed everywhere (DB + seller UI + buyer portal).

**Architecture:** Extend `confirm_order` RPC decisions with `price_per_kg`, stored on `order_items.price_per_kg` at confirm. `close_order` makes price optional (confirm price stands, still overridable). Drop `product_variants.price_per_unit` and delete the buyer estimate stack.

**Tech Stack:** Next.js App Router, Supabase plpgsql migrations, zod, next-intl, vitest.

## Global Constraints

- Repo gotcha: replaced SQL functions need explicit `revoke`/`grant execute ... to authenticated`.
- Repo gotcha: e2e specs match exact label text — grep `e2e/` for any changed copy.
- i18n: every new UI string added to all locale message files (EN + BM).
- Migration filename prefix must not collide: latest is `20260824000003`, use `20260826000001`.
- Price rule: a line needs price > 0 unless it will be cancelled (`available=false` AND `fallback='cancel'`).

---

### Task 1: Migration `supabase/migrations/20260826000001_confirm_price.sql`

**Files:** Create migration. Modify: `src/types/database.generated.ts` (drop `price_per_unit` from `product_variants` row types; confirm/close arg types unchanged — jsonb).

- [ ] Replace `confirm_order(p_order, p_decisions)` (copy body from `20260810000002_order_pipeline_functions.sql:362-457`, then):
  - Validation loop additionally reads `v_price := public._order_safe_numeric(v_decision->>'price_per_kg')` and the line's fallback; when NOT (`v_available = false` and that item's `fallback = 'cancel'`), require `v_price` not null, `> 0`, `<= 10000` else raise `message = 'invalid_price'`.
  - Apply pass: for every decision with a valid price, `update public.order_items set price_per_kg = v_price where id = ... and order_id = p_order` (in addition to the existing fallback update for unavailable lines).
- [ ] Replace `close_order`: `v_price := coalesce(public._order_safe_numeric(v_line->>'price_per_kg'), (select price_per_kg from public.order_items where id = v_item_id))`; require result not null and `>= 0` else `invalid_price`. Apply pass same coalesce before update.
- [ ] `alter table public.product_variants drop column price_per_unit;`
- [ ] Re-add `revoke all ... from public; grant execute ... to authenticated;` for both functions.
- [ ] `npx supabase db reset` (local) or push — verify migration applies clean.
- [ ] Commit: `feat(db): price at confirm, optional at close, drop variant list price`

### Task 2: Zod schemas + server actions

**Files:** `src/features/orders/types.ts:373-416`, `src/features/orders/server/order-actions.ts:283-324,735+`.

- [ ] `ConfirmOrderSchema` decision: add `pricePerKg: z.number().positive().max(10000).optional()` (optional in schema; SQL enforces the cancel-line rule).
- [ ] `confirmOrder`: map `price_per_kg: d.pricePerKg ?? null`; add `invalid_price` case to `confirmMessageKey` → `errors.orders.confirm.invalidPrice` (+ message keys in locales).
- [ ] `CloseOrderSchema` line: `pricePerKg` becomes `.optional()`.
- [ ] `closeOrder`: send `price_per_kg: l.pricePerKg ?? null`.
- [ ] Update `src/features/orders/tests/unit/types.test.ts` for new shapes; run vitest for that file.
- [ ] Commit: `feat(orders): confirm accepts per-line price`

### Task 3: Seller order detail UI

**Files:** `src/app/[locale]/(seller)/[organizationSlug]/orders/[orderId]/order-detail-client.tsx`, locale messages.

- [ ] `PendingPanel`: add `prices: Record<string, string>` state; RM/kg `Input` + market hint chip (reuse `getPriceHints` + `pickPriceHint`, same pattern as DeliveredPanel:598-611) per item card. Hide/ignore input when line is `available=false && fallback === 'cancel'`.
- [ ] Confirm button disabled until every price-requiring line parses to > 0; pass `pricePerKg` in decisions.
- [ ] `ConfirmedReadyPanel`: show `RM x.xx/kg` (`formatPrice(item.price_per_kg)`) beside each non-cancelled line.
- [ ] `DeliveredPanel`: seed draft `pricePerKg` from `item.price_per_kg` (was `""`), keep editable.
- [ ] Add i18n keys (`orders.detail.pending.pricePerKg`, `priceRequired`, `errors.orders.confirm.invalidPrice`, confirmed-panel price label) to EN + BM messages.
- [ ] Commit: `feat(orders): seller keys price at confirm; settle pre-filled`

### Task 4: Seller products — price removal

**Files:** `src/features/seller/components/products/product-card.tsx`, `product-ledger.tsx`, `variant-dialog.tsx`, `src/features/seller/lib/pricing.ts`, `catalog-model.ts`, catalog server actions writing `price_per_unit`, `src/features/market/server/actions.ts` (apply-suggestion-to-product), related market UI, tests `catalog-model.test.ts`, `apply-price.test.ts`.

- [ ] Remove price display from card + ledger (row price, `priceRange`) and the `price_per_unit` field from variant-dialog + its server action payloads.
- [ ] Remove market "apply price to product" pathway (server action + any button in market UI + `apply-price.test.ts`); keep KPDN ingest + `get_market_suggestions`.
- [ ] Update/delete affected unit tests; grep `e2e/` for price labels.
- [ ] Commit: `feat(products): remove list price from catalog`

### Task 5: Buyer portal — no prices pre-confirm

**Files:** `src/features/buyer/components/{product-card,add-to-cart-sheet,cart-overlay,cart-view,scale-chip}.tsx`, `cart-context.tsx` (CartLine price fields), `src/app/[locale]/buyer_portal/[organizationSlug]/checkout/checkout-client.tsx`, `shop/page.tsx` + `product-grid.tsx` (stop selecting `price_per_unit`), `orders/[orderId]/page.tsx`, delete `src/features/buyer/lib/price-estimate.ts` + `tests/unit/price-estimate.test.ts` (keep `BUYER_FALLBACK_KEYS` — move into `src/features/buyer/types.ts`).

- [ ] Strip RM figures/estimates from shop card, sheet, cart, checkout; keep qty/size/weight.
- [ ] Scale-chip: weight framing only.
- [ ] Buyer order page: pending → no prices; confirmed onward → `RM x.xx/kg` per line (`item.price_per_kg`); closed → totals unchanged.
- [ ] Remove unused i18n estimate keys; grep e2e.
- [ ] Commit: `feat(buyer): hide prices until seller confirms`

### Task 6: Verification

- [ ] `npm run typecheck` clean; full `npx vitest run` green.
- [ ] `npx supabase db reset` green (if local stack available).
- [ ] Browser smoke: seller confirm with prices → buyer order shows RM/kg → settle pre-filled → close total right.
