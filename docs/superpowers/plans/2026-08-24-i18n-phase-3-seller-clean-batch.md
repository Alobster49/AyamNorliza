# i18n Phase 3 — Seller Ops (Clean-File Batch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every seller-ops surface whose file is NOT held dirty by the concurrent session renders in `en`/`ms`; the 16 dirty files are explicitly deferred to a follow-up batch.

**Architecture:** Phases 1, 2, 4 are merged. This batch adds `seller`, `orders`, `logistics`, `market`, `dataConsole`, `tasks`, `errors.driver`, `errors.orders` namespaces. EN is the source of truth (verbatim → `en.json`); BM drafted per the approved glossary (Run → Trip, Dispatch → Penghantaran keluar, statuses Menunggu/Disahkan/Sedia/Dihantar/Selesai/Dibatalkan). `status.order.*` and `status.run.*` already exist — reuse, never duplicate.

**Tech Stack:** Next.js 16 App Router, next-intl 4.13, Vitest 4, Playwright 1.47.

## Global Constraints

- **EN literals → `en.json` VERBATIM** (punctuation, ellipsis, capitalisation). BM per `docs/i18n-glossary.md`.
- `en.json` first; parity test enforces `ms.json`. ICU only; counted things ICU plural (en `one`/`other`, ms single `other`) — this has been the #1 review miss, get it right first pass. Dates/numbers via next-intl `useFormatter`/`getFormatter` unless a shared money helper exists.
- Navigation from `@/i18n/navigation`; hrefs locale-agnostic.
- **DEFERRED-DIRTY LIST — never touch, never convert, never stage:** `src/app/[locale]/(seller)/[organizationSlug]/{customers/customers-client.tsx, orders/orders-client.tsx, products/products-client.tsx, runs/runs-client.tsx}`, `src/features/orders/components/{orders-board.tsx, swipe-deck.tsx, weigh-station.tsx, warehouse-empty-state.tsx}`, `src/features/logistics/components/{loading-client.tsx, timeline-view.tsx}`, `src/features/seller/components/products/{product-card.tsx, product-catalog.tsx}`, `src/features/dashboard/components/app-sidebar.tsx`, `src/components/ui/sidebar.tsx`, `src/app/globals.css`, `src/components/shared/hen-empty-state.tsx`, `next-env.d.ts`. If a task's conversion would break compilation of a dirty file (e.g. changing an export it imports), use the ADDITIVE pattern (new export alongside old) like Phase 4's `roleLabelKey`.
- `ORDER_STATUS_LABELS`/`ORDER_STATUS_COLORS` in `src/features/orders/types.ts`: COLORS stays; converted files stop reading `ORDER_STATUS_LABELS` (use `status.order.*`), but the constant itself stays exported while dirty files still read it.
- **Shared-catalog isolation procedure** (every commit touching `src/messages/*`): backup en.json/ms.json/en.d.json.ts to the session scratchpad, strip top-level `warehouse`/`deliveryRuns`/`loadingBoard`, delete en.d.json.ts + `npm run build` to regenerate, add keys, stage exact paths, verify `git diff --cached src/messages/en.json` shows ONLY your additions, commit, restore foreign namespaces + disk en.d.json.ts from backups. End state: 3 catalog files modified-unstaged.
- Never `git add -A` / `git add .`. Gates per task: `npx vitest run src/lib/i18n` + own suites, `npm run typecheck`, `npm run lint`. Branch end: all four incl. e2e (4 known dirty-tree failures are NOT ours).

## Key-naming convention

`seller.<area>.*` (shell), `orders.<area>.*`, `logistics.<area>.*`, `market.*`, `dataConsole.*`, `tasks.*`, `errors.driver.*`, `errors.orders.*`.

---

### Task 1: Seller shell (layout + sidebar)

**Files:**
- Modify: `src/app/[locale]/(seller)/[organizationSlug]/layout.tsx`, `src/features/seller/components/seller-sidebar.tsx`
- Modify: catalogs (`seller.nav.*` etc. — reuse `dashboard.pages.*`/`dashboard.sections.*` where the label text is identical), regen d.ts
- eslint: seller-sidebar is in the partial-exemption list (usePathname already converted) — finish Link/useRouter conversion, delete its exemption entry.

- [ ] Extract + convert; isolation procedure; gates; commit `feat(i18n): translate seller shell`.

### Task 2: Orders clean surfaces

**Files:**
- Modify: `orders/page.tsx`, `orders/[orderId]/page.tsx` + `order-detail-client.tsx`, `orders/new/page.tsx` + `new-order-client.tsx` (all under `src/app/[locale]/(seller)/[organizationSlug]/`)
- Modify: `src/features/orders/components/{order-card.tsx, journey-bar.tsx, queue-rail.tsx, swipe-card.tsx, size-band-gauge.tsx, board-dialogs.tsx, weigh-numpad.tsx, weight-readout.tsx}`
- Modify: catalogs (`orders.*`), regen d.ts. Status badges via `status.order.*`.

- [ ] Extract + convert; isolation procedure; gates (`+ src/features/orders`); commit `feat(i18n): translate seller order surfaces (clean batch)`.

### Task 3: Driver deck + driver action error keys

**Files:**
- Modify: `src/features/orders/components/driver-deck.tsx` (18KB — full literal extraction; run statuses via `status.run.*`)
- Modify: `src/features/orders/server/driver-actions.ts` or wherever `arriveStop`/`deliverStop`/`failStop` live (Phase 4 flagged them prose-only pending this conversion) — ADDITIVE messageKey under `errors.driver.*`; driver-deck renders `t(messageKey)`
- Modify: catalogs, regen d.ts. Tests: key-assertion per failure branch in the vitest-collected suite.

- [ ] TDD on error keys; extract + convert; isolation procedure; gates; commit `feat(i18n): translate driver deck + driver action error keys`.

### Task 4: Logistics clean surfaces

**Files:**
- Modify: `dispatch/page.tsx`, `delivery/page.tsx` + `delivery-client.tsx`, `loading/page.tsx`, `runs/page.tsx`, `runs/[runId]/manifest/page.tsx` + `print-button.tsx` (routes)
- Modify: `src/features/logistics/components/{dispatch-client.tsx, dispatch-board.tsx, bays-panel.tsx, facility-panel.tsx, plan-deck.tsx, postcode-ranges-panel.tsx, ticket-card.tsx, truck-card.tsx}` + everything under `setup/`
- Modify: catalogs (`logistics.*`), regen d.ts. Glossary: Dispatch → Penghantaran keluar, Run → Trip.

- [ ] Extract + convert; isolation procedure; gates (`+ src/features/logistics`); commit `feat(i18n): translate logistics surfaces (clean batch)`.

### Task 5: Catalog, customers, market, data console, tasks (clean surfaces)

**Files:**
- Modify: `products/page.tsx`, `customers/page.tsx`, `market-prices/page.tsx` + `market-prices-client.tsx`, `data-console/page.tsx` + `data-console-client.tsx`, `tasks/page.tsx` + `tasks-client.tsx` (routes)
- Modify: `src/features/seller/components/products/{availability-switch.tsx, category-dialog.tsx, category-rail.tsx, image-upload.tsx, product-actions-menu.tsx, product-dialog.tsx, product-ledger.tsx, variant-dialog.tsx}` (product-card/product-catalog are DIRTY — skip)
- Modify: catalogs (`market.*`, `dataConsole.*`, `tasks.*`, `seller.products.*`), regen d.ts.

- [ ] Extract + convert; isolation procedure; gates (`+ src/features/seller`); commit `feat(i18n): translate catalog/customers/market/data-console/tasks (clean batch)`.

### Task 6: Seller order-action error keys + e2e + gates

**Files:**
- Modify: seller-facing order server actions whose prose is displayed by files converted in Tasks 2-3 (find: `git grep -n "\.message" src/app/\[locale\]/(seller) src/features/orders/components` on converted files) — ADDITIVE `errors.orders.*` messageKeys; dirty consumers keep prose.
- Modify: e2e specs asserting seller copy that this batch changed structurally (EN verbatim preserved → expect few) — fix URL/prefix assertions only where failing.
- Modify: `eslint.config.mjs` — replace the broad `src/app/\\[locale\\]/(seller)/**` and `src/features/orders/components/**` / `src/features/logistics/components/**` exemption globs with an explicit file list of ONLY the deferred-dirty files, so converted files are guarded.
- Full gates; the 4 known dirty-tree e2e failures documented, not fixed.

- [ ] TDD error keys; narrow exemptions; full gates; commit `test(i18n): seller clean-batch gates; narrow lint exemptions to deferred files`.

---

## Deferred batch (separate follow-up plan once the concurrent session lands)

The 16 deferred-dirty files + `status.run.*` wiring in `runs-client.tsx` + deleting `ORDER_STATUS_LABELS` once nothing reads it.

## Copy-review gate (after Task 6, before merge)

Table of new keys (EN verbatim / BM drafted); BM is the review target. One fix commit for corrections.
