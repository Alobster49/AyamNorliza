# i18n Phase 4 — Dashboard, Settings, Identity, Cross-cutting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dashboard shell, settings, identity-access, access-control, and drive surfaces render in `en`/`ms`; role/run-status labels get translated display labels; identity/drive server-action errors return message keys; transactional emails render in the recipient's stored locale.

**Architecture:** Phases 1–2 are merged (`common`, `auth`, `status.order`, `buyer`, `errors.buyer` namespaces; routing/middleware/switcher live). Phase 3 (seller ops) is DEFERRED — its files carry another session's uncommitted edits. This phase adds `dashboard`, `settings`, `identity`, `roles`, `status.run`, `errors.identity`, `errors.drive`, `email` namespaces. English is the source of truth on these surfaces: existing EN literals → `en.json` VERBATIM; BM drafted per the approved `docs/i18n-glossary.md`.

**Tech Stack:** Next.js 16 App Router, next-intl 4.13 (`createTranslator` for email), Vitest 4, Playwright 1.47.

## Global Constraints

- **EN is the source of truth on this surface.** Every existing EN literal is copied into `en.json` VERBATIM (punctuation, ellipsis style, capitalisation). BM is drafted per the APPROVED glossary (`docs/i18n-glossary.md`) — order statuses Menunggu/Disahkan/Sedia/Dihantar/Selesai/Dibatalkan, Run → Trip, Dispatch → Penghantaran keluar, etc.
- `en.json` first; parity test (`src/lib/i18n/catalog.test.ts`) enforces `ms.json`.
- ICU placeholders only, no concatenation; counted things ICU plural (`en`: `one`/`other`; `ms`: single `other` arm).
- Navigation imports from `@/i18n/navigation` in every converted file; hrefs locale-agnostic.
- DB values (roles, statuses, zones) never change — display labels only. Follow Phase 2's established pattern: components call `t()` on `status.*`/`roles.*` keys directly (conscious deviation from the spec's `useStatusLabel()` helper — same data shape, less indirection; the spec's goal was "presentation only", which holds).
- **DO NOT TOUCH these dirty files** (other session's work): `src/features/dashboard/components/app-sidebar.tsx`, `src/components/ui/sidebar.tsx`, `src/app/globals.css`, everything under `src/app/[locale]/(seller)`, `src/features/orders/components/`, `src/features/logistics/components/`, `src/features/seller/components/products/`, `next-env.d.ts`. app-sidebar's literals join the deferred Phase 3 batch.
- **Shared-catalog isolation procedure** (required for every commit touching `src/messages/*`): the working tree carries UNSTAGED foreign namespaces `warehouse`, `deliveryRuns`, `loadingBoard` in en.json/ms.json/en.d.json.ts. Backup all 3 to the session scratchpad, strip the 3 namespaces, delete `en.d.json.ts` + `npm run build` to regenerate, add your keys, stage exact paths, verify `git diff --cached src/messages/en.json` shows ONLY your additions, commit, restore foreign namespaces + disk `en.d.json.ts` from backups. End state: 3 catalog files modified-unstaged.
- Never `git add -A` / `git add .`; stage exact paths.
- Gates per task: `npx vitest run src/lib/i18n` + the task's own suites, `npm run typecheck`, `npm run lint`. Branch end: full four gates incl. `npm run test:e2e`.

## Key-naming convention

`dashboard.*` (shell chrome, page titles), `settings.<page>.*`, `identity.<component>.*`, `roles.<dbValue>`, `status.run.<dbValue>`, `drive.*`, `errors.identity.<action>.<case>`, `errors.drive.<action>.<case>`, `email.<template>.*`.

---

### Task 1: Dashboard shell titles + `roles` / `status.run` label namespaces

**Files:**
- Modify: `src/features/dashboard/components/dashboard-shell-model.ts` (page-title/section strings → keys; `getDashboardPageContext` returns keys, `dashboard-shell-header.tsx` resolves — header is already converted, extend its `t` usage)
- Modify: `src/features/dashboard/components/dashboard-shell-header.tsx` (resolve the returned keys)
- Modify: `src/features/access-control/components/role-label.ts` (label map → key map `roles.*`; consumers in later tasks resolve; if it exports a function used server+client, keep it returning keys)
- Modify: `src/messages/en.json`, `src/messages/ms.json` (`dashboard.*`, `roles.*`, `status.run.*` — run-status EN values verbatim from the run status label map found via `grep -rn "RUN_STATUS" src/features`)
- Test: existing consumers' unit tests under `src/features/dashboard`; catalog parity auto-covers
- Regenerate: `src/messages/en.d.json.ts`

**Interfaces:**
- Produces: `roles.*` and `status.run.*` keys; `getDashboardPageContext` returning `{titleKey, sectionKey}`-style keys (exact shape: keep existing property names, values become message keys). Later tasks consume `roles.*`.

- [ ] Steps: extract EN literals verbatim → en.json; BM per glossary → ms.json; convert consumers; regen d.ts via isolation procedure; gates; commit `feat(i18n): dashboard shell titles + role/run-status label keys`.

### Task 2: Settings pages (server pages + org settings client)

**Files:**
- Modify: `src/app/[locale]/(dashboard)/[organizationSlug]/layout.tsx`, `settings/organization/page.tsx` + `organization-settings-client.tsx`, `settings/users/page.tsx`, `settings/users/[userId]/page.tsx`, `settings/roles/page.tsx`, `settings/audit-log/page.tsx`, `settings/access-reviews/page.tsx`, `settings/support-sessions/page.tsx`, `profile/security/page.tsx`
- Modify: catalogs (`settings.*`), regen d.ts

**Interfaces:** Consumes Task 1's `roles.*` where role names render.

- [ ] Steps: per-file extract + convert (server pages `getTranslations`, clients `useTranslations`); isolation procedure; gates; commit `feat(i18n): translate settings pages`.

### Task 3: identity-access client components

**Files:**
- Modify: all 8 in `src/features/identity-access/components/` (`users-page-client.tsx`, `user-detail-client.tsx`, `roles-page-client.tsx`, `access-reviews-client.tsx`, `audit-log-client.tsx`, `support-sessions-client.tsx`, `security-panel.tsx`, `break-glass-dialog.ts`)
- Modify: catalogs (`identity.*`), regen d.ts
- Delete from `eslint.config.mjs` exemptions: `src/features/identity-access/components/**` glob once converted; lint must stay green.

- [ ] Steps: extract + convert; dates via `useFormatter`; isolation procedure; gates; commit `feat(i18n): translate identity-access components`.

### Task 4: access-control components + drive

**Files:**
- Modify: `src/features/access-control/components/` (`capability-matrix.tsx`, `invitations-queue.tsx`, `rank-ladder.tsx`, `role-roster.tsx`, `roles-masthead.tsx`) resolving `roles.*` keys from Task 1
- Modify: the 2 drive `.tsx` files (find via `find src/app/[locale]/drive src/features/drive -name "*.tsx"`)
- Modify: catalogs (`identity.*` additions, `drive.*`), regen d.ts
- Modify: `eslint.config.mjs` — remove exemptions for files now converted (incl. the forms listed individually: `update-organization-form.tsx`, `invite-user-dialog.tsx`, `break-glass-dialog.tsx`, `reauth-dialog.tsx` — convert them here too if they carry literals)

- [ ] Steps: extract + convert; isolation procedure; gates; commit `feat(i18n): translate access-control, drive, and remaining forms`.

### Task 5: identity/drive server-action error keys

**Files:**
- Modify: identity-access + drive server actions returning prose errors (find via `grep -rn "message:" src/features/identity-access/server src/features/drive/server` — scope to user-displayed messages only)
- Modify: their client consumers to `t(result.messageKey)` (root-namespace `useTranslations()`, local `as never` cast + comment — Phase 2's pattern)
- Modify: catalogs (`errors.identity.*`, `errors.drive.*`), regen d.ts
- Test: one unit test per failure branch asserting the exact messageKey (suites under `src/features/identity-access/tests/unit/` etc.)

- [ ] Steps: TDD (failing key-assertion tests first); EN prose → en.json verbatim, BM drafted; isolation procedure; gates; commit `feat(i18n): identity/drive server-action errors return message keys`.

### Task 6: Transactional email locale

**Files:**
- Modify: `src/lib/email/messages.ts`, `render-invite.ts`, `render-break-glass.ts`, `render-mfa-enrolled.ts`, `render-support-session-opened.ts`, `render-temporary-access-expiring.ts` — each takes a `locale: AppLocale` parameter (default `"en"`), renders via next-intl `createTranslator({locale, messages})` with messages loaded from `src/messages/{locale}.json`
- Modify: every caller of these renderers — resolve the recipient's stored locale (`profiles.locale` or `buyers.locale`, whichever identity the recipient has; fall back `"en"`)
- Modify: catalogs (`email.*` — existing EN template copy verbatim), regen d.ts
- Test: extend `src/lib/email/templates.test.ts` — every template renders in BOTH locales, asserts a distinctive string per locale.

- [ ] Steps: TDD; isolation procedure; gates; commit `feat(i18n): transactional emails render in recipient locale`.

### Task 7: E2E + branch gates

**Files:**
- Modify: any e2e spec asserting settings/identity copy that breaks (dashboard-shell, invite, access-review, role-change, break-glass, deactivation specs land on `/en` where EN copy is verbatim-preserved — expect mostly no changes; fix URL assertions lacking locale prefix if any fail)
- Verify `eslint.config.mjs` has no exemption left for any surface converted in this phase.

- [ ] Steps: run full gates `npm run typecheck && npm test && npm run lint && npm run test:e2e`; fix what this phase broke (the 4 known failures caused by the other session's dirty tree are NOT ours — note them); commit `test(i18n): phase 4 e2e adjustments`.

---

## Copy-review gate (after Task 7, before merge)

Table of every new key: EN (verbatim or drafted) + BM draft. BM drafts are the review target this phase (EN mostly verbatim). One fix commit for corrections.
