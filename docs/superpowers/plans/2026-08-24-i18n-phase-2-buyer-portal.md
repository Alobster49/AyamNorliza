# i18n Phase 2 — Buyer Portal Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every buyer-portal screen, component, and server-action error renders in the active locale (`en`/`ms`), with the existing hand-written BM copy preserved verbatim as the `ms.json` source of truth.

**Architecture:** Phase 1 infrastructure (routing, middleware, switcher, `common`/`auth` namespaces) is merged. This phase adds `buyer`, `status`, and `errors.buyer` namespaces, converts 12 route files + 12 feature components from hardcoded BM to `useTranslations`/`getTranslations`, converts their navigation to `@/i18n/navigation`, and migrates buyer server actions from prose `message` strings to `messageKey`s the client resolves. English copy is drafted to match the BM meaning.

**Tech Stack:** Next.js 16 App Router, next-intl 4.13, Vitest 4, Playwright 1.47.

## Global Constraints

- **BM is the source of truth on this surface.** Every existing BM literal is copied into `ms.json` VERBATIM — same punctuation, same ellipsis style (`...` vs `…`), same capitalisation. Zero copy edits. The English value is a fresh draft conveying the same meaning.
- `en.json` is the schema source of truth: add every new key to `en.json` first; the catalog-parity test (`src/lib/i18n/catalog.test.ts`) enforces `ms.json` matches.
- No string concatenation — ICU placeholders only (`{name}`, `{count, plural, ...}`).
- All internal navigation in converted files imports `Link`/`useRouter`/`usePathname`/`redirect` from `@/i18n/navigation`, never `next/link`/`next/navigation`. Exception: `router.refresh()` needs no locale awareness but still comes via `@/i18n/navigation`'s `useRouter`.
- When a file is fully converted, DELETE its exemption from `eslint.config.mjs` (or the glob covering it — see Task 6). Never add new exemptions.
- DB values (`pending`, `confirmed`, …) never change; only display labels are translated.
- Never touch the other session's uncommitted files. Stage files by exact path — never `git add -A` / `git add .`.
- Gates per task: named unit tests. Gates at branch end: `npm run typecheck`, `npm test`, `npm run lint`, `npm run test:e2e`.
- Regenerating `src/messages/en.d.json.ts`: delete it and run `npm run build` (it is committed, never hand-edited). Only needed when keys change; commit the regenerated file with the catalog change.

## Key-naming convention

`buyer.<area>.<element>` where area ∈ `nav`, `header`, `cart`, `shop`, `product`, `checkout`, `login`, `orders`, `orderDetail`, `profile`, `pricing`. Status labels live in `status.order.<dbValue>`. Server-action errors in `errors.buyer.<action>.<case>`.

## Conversion pattern (applies to every task)

Client component:

```tsx
// before
<span className="sr-only">Troli</span>
// after
const t = useTranslations("buyer.header");
<span className="sr-only">{t("cart")}</span>
```

with `en.json` `"buyer": { "header": { "cart": "Cart" } }` and `ms.json` `"buyer": { "header": { "cart": "Troli" } }`.

Server component (async page):

```tsx
import { getTranslations } from "next-intl/server";
const t = await getTranslations("buyer.orders");
```

Status label (server page):

```tsx
const tStatus = await getTranslations("status");
<Badge>{tStatus(`order.${order.status}`)}</Badge>
```

Navigation:

```tsx
// before
import Link from "next/link";
import { useRouter } from "next/navigation";
// after
import { Link, useRouter } from "@/i18n/navigation";
```

`Link href` values stay locale-agnostic (`/buyer_portal/${slug}/shop`) — the wrapper adds the prefix.

---

### Task 1: `status.order` namespace + shared buyer components

**Files:**
- Modify: `src/messages/en.json`, `src/messages/ms.json` (add `status.order.*`, `buyer.header.*`, `buyer.nav.*`, `buyer.cart.*`, `buyer.product.*`, `buyer.pricing.*`, `buyer.orderTracker.*`)
- Modify: `src/features/buyer/components/buyer-header.tsx`
- Modify: `src/features/buyer/components/cart-view.tsx`
- Modify: `src/features/buyer/components/cart-overlay.tsx`
- Modify: `src/features/buyer/components/add-to-cart-sheet.tsx`
- Modify: `src/features/buyer/components/buyer-sheet.tsx`
- Modify: `src/features/buyer/components/product-card.tsx`
- Modify: `src/features/buyer/components/scale-chip.tsx`
- Modify: `src/features/buyer/components/pricing-explainer-sheet.tsx`
- Modify: `src/features/buyer/components/order-tracker.tsx`
- Regenerate: `src/messages/en.d.json.ts`
- Test: existing `src/lib/i18n/catalog.test.ts` (parity auto-covers new keys)

**Interfaces:**
- Produces: `status.order.{pending,confirmed,ready,delivered,closed,cancelled}` keys — Tasks 4 consumes them. `buyer.*` namespaces per the convention — later tasks extend, never rename.

- [ ] **Step 1: Add `status.order` keys.** `en.json` values = the exact strings in `ORDER_STATUS_LABELS` (`src/features/orders/types.ts:23-30`): Pending, Confirmed, Ready, Delivered, Closed, Cancelled. `ms.json` drafts: Menunggu, Disahkan, Sedia, Dihantar, Selesai, Dibatalkan. (BM drafts here — flagged for the copy-review gate; everywhere else in this phase BM is verbatim-preserved, these six are new.)
- [ ] **Step 2: Extract every user-visible literal** from the nine components into `buyer.*` keys. BM literal → `ms.json` verbatim; draft the matching English into `en.json`. Includes `sr-only` text, `aria-label`s, `alt` text on non-brand images (the "NB Poultry Processing Industries" logo `alt` is a brand name — leave it), dropdown items, empty-state copy, button labels. Dynamic counts use ICU plural.
- [ ] **Step 3: Convert the nine components** to `useTranslations`, and their `Link`/`useRouter` imports to `@/i18n/navigation` (buyer-header currently mixes: `usePathname` already converted, `Link`+`useRouter` not — finish it).
- [ ] **Step 4: Regenerate `en.d.json.ts`** (delete + `npm run build`).
- [ ] **Step 5: Run gates:** `npx vitest run src/lib/i18n` (parity green), `npm run typecheck`.
- [ ] **Step 6: Update eslint exemptions:** delete `src/features/buyer/components/cart-overlay.tsx` and `cart-view.tsx` lines from the first exemption list, delete `buyer-header.tsx` from the partial-exemption list in `eslint.config.mjs`. `npm run lint` green.
- [ ] **Step 7: Commit** `feat(i18n): translate shared buyer components + order status labels`.

### Task 2: Shop, cart, and login pages

**Files:**
- Modify: `src/app/[locale]/buyer_portal/[organizationSlug]/shop/page.tsx`
- Modify: `src/app/[locale]/buyer_portal/[organizationSlug]/shop/product-grid.tsx`
- Modify: `src/app/[locale]/buyer_portal/[organizationSlug]/cart/page.tsx`
- Modify: `src/app/[locale]/buyer_portal/[organizationSlug]/login/page.tsx` (376 lines — the largest here; includes form labels, validation hints, tab labels, links)
- Modify: `src/app/[locale]/buyer_portal/[organizationSlug]/layout.tsx` (any literals; metadata strings via `getTranslations`)
- Modify: `src/messages/en.json`, `src/messages/ms.json` (`buyer.shop.*`, `buyer.cart.*` additions, `buyer.login.*`)
- Regenerate: `src/messages/en.d.json.ts`

**Interfaces:**
- Consumes: Task 1's `buyer.*` conventions.
- Produces: `buyer.login.*` keys — Task 5's error consumers reference the same page.

- [ ] **Step 1: Extract + convert** each file per the conversion pattern. Server pages use `getTranslations`; client components `useTranslations`. `generateMetadata` (if present) uses `getTranslations({locale, namespace})`.
- [ ] **Step 2: Regenerate `en.d.json.ts`.**
- [ ] **Step 3: Gates:** `npx vitest run src/lib/i18n`, `npm run typecheck`, `npm run lint`.
- [ ] **Step 4: Hand-verify** (dev server): `/ms/buyer_portal/ayam-norliza-pilot/shop` shows the ORIGINAL BM copy character-for-character; `/en/...` shows English. Verify with `read_page`.
- [ ] **Step 5: Commit** `feat(i18n): translate buyer shop, cart, and login pages`.

### Task 3: Checkout

**Files:**
- Modify: `src/app/[locale]/buyer_portal/[organizationSlug]/checkout/page.tsx`
- Modify: `src/app/[locale]/buyer_portal/[organizationSlug]/checkout/checkout-client.tsx` (615 lines — the largest file in the phase)
- Modify: `src/app/[locale]/buyer_portal/[organizationSlug]/checkout/account-section.tsx`
- Modify: `src/messages/en.json`, `src/messages/ms.json` (`buyer.checkout.*`)
- Regenerate: `src/messages/en.d.json.ts`

**Interfaces:**
- Consumes: Task 1 conventions; `common.*` keys where a string already exists there (check before adding duplicates).

- [ ] **Step 1: Extract + convert.** checkout-client has multi-step flow copy, quantity/price formatting, and inline validation strings — every one becomes a key; numbers/currency go through next-intl `useFormatter` where a `toLocaleString` exists today.
- [ ] **Step 2: Regenerate `en.d.json.ts`.**
- [ ] **Step 3: Gates:** `npx vitest run src/lib/i18n src/features/buyer`, `npm run typecheck`, `npm run lint`.
- [ ] **Step 4: Commit** `feat(i18n): translate buyer checkout flow`.

### Task 4: Orders, order detail, profile

**Files:**
- Modify: `src/app/[locale]/buyer_portal/[organizationSlug]/orders/page.tsx`
- Modify: `src/app/[locale]/buyer_portal/[organizationSlug]/orders/[orderId]/page.tsx`
- Modify: `src/app/[locale]/buyer_portal/[organizationSlug]/orders/[orderId]/cancel-order-button.tsx`
- Modify: `src/app/[locale]/buyer_portal/[organizationSlug]/profile/page.tsx`
- Modify: `src/messages/en.json`, `src/messages/ms.json` (`buyer.orders.*`, `buyer.orderDetail.*`, `buyer.profile.*`)
- Regenerate: `src/messages/en.d.json.ts`

**Interfaces:**
- Consumes: `status.order.*` from Task 1 — both orders pages replace `ORDER_STATUS_LABELS[order.status]` with `tStatus(\`order.${order.status}\`)`. `ORDER_STATUS_COLORS` stays as-is (CSS, not copy). Do NOT edit `src/features/orders/types.ts` — seller surfaces still consume `ORDER_STATUS_LABELS` until Phase 3/4.

- [ ] **Step 1: Extract + convert** the four files; status badges per the status-label pattern; dates through `format.dateTime`.
- [ ] **Step 2: Regenerate `en.d.json.ts`.**
- [ ] **Step 3: Gates:** `npx vitest run src/lib/i18n`, `npm run typecheck`, `npm run lint`.
- [ ] **Step 4: Commit** `feat(i18n): translate buyer orders and profile pages`.

### Task 5: Server-action error keys

**Files:**
- Modify: `src/features/buyer-auth/server/auth-actions.ts`
- Modify: `src/features/buyer/server/actions.ts`
- Modify: `src/features/buyer/server/address-actions.ts`
- Modify: every client consumer that displays the returned `message` (login page, checkout-client, account-section, profile page — found via `grep -rn "\.message" src/app/\[locale\]/buyer_portal src/features/buyer`)
- Modify: `src/messages/en.json`, `src/messages/ms.json` (`errors.buyer.*`)
- Test: `src/features/buyer/tests/unit/` + `src/features/buyer-auth` existing suites (update assertions from prose to keys)
- Regenerate: `src/messages/en.d.json.ts`

**Interfaces:**
- Produces: action results carry `messageKey: string` (a key under `errors.buyer`) INSTEAD of prose `message`. The helper at `auth-actions.ts:19-22` changes signature; every call site updates in the same commit.

- [ ] **Step 1: Write/adjust failing unit tests** asserting actions return `messageKey: "errors.buyer.<...>"` for each failure case (invalid input, already registered, wrong credentials, org not found — one test per existing prose message).
- [ ] **Step 2: Convert actions.** Every prose `message:` value becomes a key; the BM prose (if BM) moves verbatim to `ms.json`, English drafted; if today's prose is English, it moves verbatim to `en.json` and BM is drafted.
- [ ] **Step 3: Convert client consumers** to `t(result.messageKey)` — next-intl needs namespace-relative keys, so consumers use `useTranslations()` (root namespace) and pass the full key.
- [ ] **Step 4: Gates:** `npx vitest run src/features/buyer src/features/buyer-auth src/lib/i18n`, `npm run typecheck`, `npm run lint`.
- [ ] **Step 5: Commit** `feat(i18n): buyer server-action errors return message keys`.

### Task 6: E2E locale updates + branch gates

**Files:**
- Modify: `e2e/buyer-order.spec.ts`, `e2e/buyer-address.spec.ts`, `e2e/buyer-inline-signup.spec.ts` — any spec asserting BM copy now navigates `/ms/...` explicitly (or asserts the English label on `/en`). Pick per-spec: keep BM assertions + `/ms` navigation, since BM strings are the verbatim-preserved ones.
- Modify: `eslint.config.mjs` — delete the `src/app/\\[locale\\]/buyer_portal/**` glob from the exemption list (all buyer route files now converted).

- [ ] **Step 1: Update buyer specs** to explicit `/ms` navigation.
- [ ] **Step 2: Delete the buyer_portal eslint exemption glob.** `npm run lint` must stay green — any failure is an unconverted literal path missed by Tasks 1-4; fix it, don't re-add the exemption.
- [ ] **Step 3: Full gates:** `npm run typecheck && npm test && npm run lint && npm run test:e2e`.
- [ ] **Step 4: Commit** `test(i18n): buyer e2e specs navigate /ms; drop buyer lint exemptions`.

---

## Copy-review gate (after Task 6, before merge)

Produce for the user: a two-column table (key, EN draft) of every NEW English string drafted this phase, plus the six new BM status labels. BM verbatim strings need no review (unchanged copy). User approves or corrects; corrections are one fix commit.
