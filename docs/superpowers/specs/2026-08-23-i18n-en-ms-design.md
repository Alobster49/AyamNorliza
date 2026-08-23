# Bilingual UI (English + Bahasa Melayu) — Design

**Date:** 2026-08-23
**Status:** Approved for planning
**Scope:** Whole application — seller dashboard, buyer portal, auth, settings, drive, transactional emails.

## Problem

The application ships two languages today, but neither is a choice. The seller
dashboard is hardcoded English; the buyer portal is hardcoded Bahasa Melayu
after the recent BM copy sweep. A Malaysian staff member cannot read the
dispatch board in BM, and an English-speaking buyer cannot read the shop. There
is no i18n library, no locale routing, and no way for a user to switch.

`profiles.locale` exists (`text not null default 'en'`) and is unused by the
UI. `buyers` has no locale column.

## Goals

- Both languages available on every surface, switchable by the user at any time.
- The choice persists across sessions and devices for signed-in users, and
  across page loads for anonymous visitors.
- Shareable, SEO-distinct URLs per language.
- Translated coverage extends past page chrome to validation errors, status
  labels, and transactional email.

## Non-goals

- Translating user-entered data (product names, customer notes, organization
  names). Those stay in whatever language staff typed them. No per-language DB
  columns, no translation UI.
- Additional locales beyond `en` and `ms`. The structure allows more later; this
  project ships two.
- Right-to-left layout support. Neither locale needs it.

## Decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Engine | `next-intl@^4.13` | Built for the App Router. Supplies locale routing, middleware, server and client translation, ICU plurals, and typed keys in one dependency. Peer deps cover Next 16 and React 18. |
| URL strategy | Locale prefix (`/en/...`, `/ms/...`) | Shareable per-language links and a real SEO signal, which the cookie-only approach cannot give. |
| Landing default | `en` everywhere | Both languages reach every surface; English is the fallback when no preference exists. |
| Persistence | Cookie plus DB for signed-in users | Cookie covers anonymous visitors; the DB row follows the user across devices and lets email pick the right language. |
| Switcher placement | Header control on every surface | Reachable before login, which a settings-only control is not. |
| Copy authoring | Drafted here, reviewed per phase | Operational jargon translated badly is worse than untranslated. A glossary approved up front constrains the drafts. |

## Architecture

### Routing

- `src/i18n/routing.ts` — `locales: ['en', 'ms']`, `defaultLocale: 'en'`,
  `localePrefix: 'always'`.
- `src/i18n/request.ts` — `getRequestConfig` resolves the active locale and
  loads its catalog.
- `src/i18n/navigation.ts` — re-exports next-intl's `Link`, `redirect`,
  `usePathname`, `useRouter`. All internal navigation goes through these so the
  prefix is never dropped.

All page routes move under a locale segment:

```
src/app/[locale]/(auth)/…
src/app/[locale]/(dashboard)/…
src/app/[locale]/(seller)/…
src/app/[locale]/buyer_portal/…
src/app/[locale]/drive/…
src/app/[locale]/[organizationSlug]/…
src/app/[locale]/page.tsx
src/app/api/…            ← unchanged, not localized
```

`src/app/[locale]/layout.tsx` becomes the root layout: it renders `<html>` and
`<body>`, sets `lang={locale}`, and wraps children in `NextIntlClientProvider`
alongside the existing `ThemeProvider`, `TooltipProvider`, and `Toaster`. A
minimal `src/app/not-found.tsx` keeps its own `<html>`/`<body>` so 404s outside
any locale segment still render.

### Middleware

The repository has one `src/middleware.ts` whose sole job is publishing
`x-pathname` (`PATHNAME_HEADER`) to Server Components. The filename stays
`middleware.ts`, not `proxy.ts`, for the Turbopack reason already documented in
that file.

It gains a second responsibility: run `createMiddleware(routing)` first, then
set `PATHNAME_HEADER` on the request forwarded by the result. Order matters —
the header must carry the resolved, prefixed pathname so that `?next=` round
trips preserve the locale.

The matcher widens to include `/login`, `/signup`, `/mfa`, and `/auth/*`, which
previously were excluded but now need prefixing. `_next`, `api`, and static
files stay excluded; the `_next` exclusion in particular must survive, because
routing `_next/webpack-hmr` through the middleware breaks HMR in dev.

Bare URLs redirect rather than break: `/ayam-norliza-pilot/orders` returns a 307
to `/en/ayam-norliza-pilot/orders`. Existing bookmarks and e2e `goto()` calls
keep working.

### Message catalogs

`src/messages/en.json` and `src/messages/ms.json`, namespaced by feature:

```
common, auth, buyer, orders, dispatch, runs, customers,
products, settings, status, errors
```

`en.json` is the schema source of truth. `global.d.ts` declares
`Messages = typeof en`, making `useTranslations` keys typechecked — a missing or
misspelled key fails the build instead of rendering a placeholder.

Conventions:

- No string concatenation. Interpolate through ICU placeholders.
- ICU plurals for anything counted.
- Dates, numbers, and RM currency go through next-intl formatters, not ad-hoc
  `toLocaleString` calls.

A Vitest test asserts the two catalogs have identical key sets, so drift shows
up in review rather than as an untranslated string in production.

### Glossary

`docs/i18n-glossary.md` fixes the BM rendering of operational jargon: dispatch,
run, kanban column names, zone, add-on, batch, coop, and the order and run
status vocabulary. It is written and approved before any copy phase begins, and
every draft afterwards conforms to it.

## Locale resolution and persistence

Resolution order: **URL prefix → cookie `NEXT_LOCALE` → DB locale → `en`**.

The URL segment always wins at render time, because middleware guarantees one is
present. Cookie and DB values influence only where a bare-URL redirect points.
This rule eliminates hydration mismatch: server and client both read the same
segment and cannot disagree.

### Database

New migration, numbered after `20260823000012` (the highest already applied to
production):

- `alter table public.buyers add column locale text not null default 'en'
  check (locale in ('en','ms'))`
- `profiles.locale` already exists with a `char_length(locale) between 2 and 10`
  check. Drop that constraint and add `check (locale in ('en','ms'))` in its
  place, so both tables enforce the same value set. Existing rows are all
  `'en'`, so there is no backfill and no constraint violation.
- Grants on the new column, per the repository's standing grants gotcha.

### Server action

`setLocale(locale)`:

1. Validates against the supported locale list.
2. Writes the `NEXT_LOCALE` cookie with a one-year max-age.
3. If a session exists, upserts `profiles.locale` or `buyers.locale` depending
   on which identity the session carries.

At the auth boundary only, if the stored DB locale differs from the URL locale,
the user is redirected once to the stored locale. This happens on sign-in, not
on every navigation.

### Switcher

`src/components/shared/locale-switcher.tsx` — a segmented `EN | BM` control. On
change it calls `setLocale`, then `router.replace` on the current pathname with
the locale segment swapped, so the user stays on the page they were reading.

Mounted in the buyer header, the seller top bar, the dashboard shell header, and
the auth pages (login, signup, invite, MFA). Mirrored as a row in profile
settings for discoverability.

## Text beyond page chrome

### Validation and server-action errors

Zod schemas carry message keys (`errors.order.qtyTooLow`) rather than English
prose. Server actions return `{ ok: false, messageKey }`. The client resolves
through `t()`. No English prose crosses the wire, so a BM user never sees a
stray English toast.

### Status and enum labels

Database values are unchanged — `draft`, `confirmed`, `dispatched`, and the role
and zone vocabularies all stay English in the schema, in RLS policies, and in
every query. Only the display label is translated, through a single
`useStatusLabel()` helper reading `status.order.*`, `status.run.*`, and
`roles.*`. This keeps the change to presentation and leaves data and
authorization untouched.

### Transactional email

`src/lib/email/messages.ts` and the `render-*.ts` templates take a `locale`
parameter. The caller resolves the recipient's stored locale from `profiles` or
`buyers`, falling back to `en`. Rendering uses next-intl's `createTranslator`,
which works outside request scope, so no synthetic request is needed.

## Implementation phases

Each phase merges to `main` on its own. Long-lived branches are the main risk
here, and per-phase merging is the mitigation.

**Phase 1 — Infrastructure.** Add the dependency, `src/i18n/*`, the route move,
the root layout, the composed middleware, the migration, the `setLocale` action,
the switcher component, and the `common` and `auth` namespaces (roughly four
auth pages plus the shells). Every other surface keeps its hardcoded strings and
continues to render. This phase is mostly mechanical and must be green before
any copy work starts.

**Phase 2 — Buyer portal.** `app/[locale]/buyer_portal` (12 files) plus
`features/buyer` (11 files). The existing hand-written BM becomes the `ms.json`
source of truth; the English half is drafted to match.

**Phase 3 — Seller operations.** Roughly 64 files, in three separately merged
sub-batches:

- 3a: orders, the kanban board, order detail.
- 3b: logistics — dispatch, delivery, runs.
- 3c: catalog, products, customers, market prices, data console, tasks.

English is the source; BM is drafted against the glossary.

**Phase 4 — Dashboard, settings, identity, cross-cutting.** Roughly 26 files
across `(dashboard)`, `identity-access`, `access-control`, and `drive`, plus the
enum label map, the Zod error keys, and the email locale plumbing.

The copy review gate sits at the end of each phase, scoped to that phase's copy
diff.

## Testing

**Unit (Vitest)**

- Catalog key parity between `en.json` and `ms.json`.
- Locale resolution precedence, including the bare-URL redirect target.
- Enum label map covers every value in each status union.
- Email templates render in both locales.

**End-to-end (Playwright)**

The 307 on bare URLs means most of the 14 existing specs need no change. Two
need real edits: the buyer specs assert BM text (for example `"Log Masuk"`) but
now land on `/en`, so they either navigate `/ms` explicitly or assert the
English label. This is the label-coupling hazard the repository has hit before.

One new spec covers the feature itself: switch language, assert the URL prefix
changes, assert it survives a reload, and assert it survives re-login in a fresh
browser context.

Every phase must pass `npm run typecheck`, `npm test`, and `npm run test:e2e`
before it merges.

## Risks

**The route move, not the translating, is the dangerous part.** Every `Link`,
`redirect()`, and `router.push` holding a literal path must go through the
next-intl navigation wrappers, or it drops the prefix and bounces through a
redirect. Phase 1 includes a deliberate sweep for literal paths rather than
discovering them one broken button at a time.

**`?next=` and the auth redirects** touch the same code as the recent buyer-auth
signup rollback fix. That area gets extra test coverage in phase 1.

**Unmerged phases compound.** A 150-file sweep held on one branch will conflict
with ordinary feature work. If phases stop merging, the cost rises sharply.

**BM jargon quality** is the most likely source of embarrassment in front of
staff. The glossary gate before phase 3 is the cheap insurance against it.
