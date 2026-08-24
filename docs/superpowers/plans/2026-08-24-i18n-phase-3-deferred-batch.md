# i18n Phase 3 — Deferred Batch (Final Sweep) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the 14 formerly-dirty seller/shell files now landed on `main` (7f13e56), close every residual from the Phase 3 final review, and finish the bilingual sweep — after this branch, no user-visible surface renders hardcoded copy.

**Architecture:** All namespaces exist (seller, orders, logistics, market, dataConsole, tasks, status.*, roles, errors.*). The concurrent session's work is committed; the working tree is CLEAN — **no shared-catalog isolation procedure anymore**: edit catalogs normally, stage by exact path. `warehouse`/`deliveryRuns`/`loadingBoard` namespaces are now legitimate committed keys (already bilingual — the empty-state components consuming them are ALREADY converted; verify, don't re-do).

**Tech Stack:** Next.js 16 App Router, next-intl 4.13, Vitest 4, Playwright 1.47.

## Global Constraints

- EN literals → `en.json` VERBATIM; BM per approved `docs/i18n-glossary.md` (Run → Trip, Dispatch → "Penghantaran keluar" — sentence case, fix the Title-Case dup in `dashboard.pages` if present); ICU plural for counted things (en `one`/`other`, ms `other`-only).
- Reuse existing keys (`status.order.*`, `status.run.*`, `common.*`, `dashboard.pages/sections.*`) — never duplicate.
- Navigation from `@/i18n/navigation`; hrefs locale-agnostic.
- Stage exact paths; never `git add -A`. Tree is clean — any unexpected dirty file is a stop-and-report.
- Gates per task: `npx vitest run src/lib/i18n` + own suites, `npm run typecheck`, `npm run lint`. Branch end: all four incl. `npm run test:e2e` (local Supabase already running).

---

### Task 1: Orders cluster + runs

**Files:** `src/app/[locale]/(seller)/[organizationSlug]/orders/orders-client.tsx`, `runs/runs-client.tsx`; `src/features/orders/components/{orders-board.tsx, swipe-deck.tsx, weigh-station.tsx}`; catalogs (`orders.*` extensions); e2e `orders-kanban.spec.ts` (currently RED: asserts removed copy "Grouped by status" — update assertions to the new EN copy/keys as part of this task).
- runs-client: wire `status.run.*` (In the yard / On the road / Back in) — the orphan-key finding.
- After conversion: if `ORDER_STATUS_LABELS` in `src/features/orders/types.ts` has zero remaining readers, DELETE it (and stale test assertions); else report readers.
- [ ] Extract + convert; gates + `npx playwright test orders-kanban`; commit.

### Task 2: Logistics + driver residuals

**Files:** `src/features/logistics/components/{loading-client.tsx, timeline-view.tsx}`; `src/features/orders/components/driver-deck.tsx` (add `?? result.message` fallback at the 4 messageKey render sites — LOW-3); `dispatch-actions.ts` `applyPlan.failed[]` gains additive `messageKey`, `plan-deck.tsx` acceptAll partial-failure toast resolves it; catalogs (`logistics.*` extensions).
- [ ] Extract + convert; gates (`src/features/logistics src/features/orders`); commit.

### Task 3: Products/customers cluster + shell

**Files:** `products/products-client.tsx`, `customers/customers-client.tsx` (routes); `src/features/seller/components/products/{product-card.tsx, product-catalog.tsx}`; `src/components/shared/hen-empty-state.tsx` (verify — may already consume keys); `src/features/dashboard/components/app-sidebar.tsx` (consume `titleKey`/`sectionKey` from `getDashboardPageContext`/DASHBOARD_ROUTES — then delete the now-dead literal `title`/`section` fields and `getDefaultPageContext()` if unused); `src/components/ui/sidebar.tsx` (translate sr-only/aria strings only — it's a shadcn primitive, keep API stable); e2e `invite.spec.ts` (RED: asserts removed "Products & Catalog" — update).
- [ ] Extract + convert; gates + `npx playwright test invite`; commit.

### Task 4: Guard sweep + cleanup + full gates

- eslint.config.mjs: DELETE the deferred-file exemption entries entirely (all now converted); add `redirect` to the `no-restricted-imports` importNames guard; convert every bare `next/navigation` `redirect` site the new rule flags — locale-prefix via `getLocale()` (require-user pattern) for user-facing redirects; genuinely locale-irrelevant sites (API routes, auth callback plumbing) get targeted per-file exemption with a comment.
- Key dedup: `dataConsole.seedCard.cancel` and `orders.driverDeck.back` → reuse `common.cancel`/`common.back`; fix "Penghantaran Keluar" casing inconsistency; drop the dead `label` computation for `postcodeMatch` in setup-model (or comment it).
- Full gates incl. `npm run test:e2e` — everything must be green now (stack is up; no other-session excuse remains).
- [ ] Sweep; gates; commit.

## Copy-review gate

Append new keys to a delta table for the user (same format as prior phases).
