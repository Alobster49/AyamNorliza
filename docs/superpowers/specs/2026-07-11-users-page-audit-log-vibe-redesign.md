# Users page — Audit-Log Vibe Redesign

**Date:** 2026-07-11
**Owner:** frontend
**Status:** design (approved)
**Affects:** `src/app/(dashboard)/[organizationSlug]/settings/roles/page.tsx`

## Context

The "Users" page currently renders an editorial / newspaper spread — large display-font masthead, italic accent ampersand, `Issue 01 · Phase 1 read-only` kicker, sections titled "The matrix", "The roster", "The rank ladder", and "The invitations queue". This is a deliberate aesthetic, but it stands apart from the Audit Log page, which has a calm, dense, command-center vibe: compact icon header + stat tiles + filter card + sticky date-bucket timeline + right-side Sheet for detail.

Goal: align the Users page's visual furniture with the Audit Log page so a user moving between the two feels the same surface. Information architecture shifts from "magazine spread" to "single primary stream (members) with one supporting filter", modelled on the Audit Log's single primary stream (events).

This change is **presentation only**. No schema, no migrations, no new server actions, no changes to `permissions.ts` or any RLS policy. Existing `RolesPageClient` editor and `getRolesView` data stay where they are.

## Out of scope

- No deletion of editorial components (`RolesMasthead`, `CapabilityMatrix`, `RoleRoster`, `RankLadder`, `InvitationsQueue`). They remain in the codebase for future re-use but are not rendered on this page round.
- No changes to the editable matrix experience (`RolesPageClient`). Owners still access it through the existing route handling.
- No new permission or capability checks. All access decisions use existing helpers (`can`, `isCapabilityOverridable`, `isRoleEditable`).

## Design

### Page structure (top → bottom)

1. Header — icon + title + subtitle + three stat tiles.
2. Filter card — role / status / scope selects + search input + Clear.
3. Timeline — date-bucket grouped member rows.
4. Right-side Sheet — member detail panel (history-bound by `?row=`).

### 1. Header

Structure mirrors `src/app/(dashboard)/[organizationSlug]/settings/audit-log/page.tsx` lines 49–71.

- Icon: `lucide-react` `Users` inside `size-9 rounded-lg bg-muted text-muted-foreground`.
- Title: `<h1 className="text-2xl font-semibold tracking-tight">Users</h1>`.
- Subtitle: `Every person with access to this organization. Newest first.`
- Three stat tiles, same `rounded-lg border bg-card px-3 py-2`:
  - `Members` — total active + invited + suspended (org-wide count).
  - `Active` — count of `status === "active"` members.
  - `Pending invites` — count of invitations with `acceptedAt == null && revokedAt == null`.

### 2. Filter card

Mirror of `AuditLogClient`'s filter card (`src/features/identity-access/components/audit-log-client.tsx` lines 236–335).

- `border-b` row with `Filter` icon + "Filters" label.
- Selects (same `size="sm"` triggers, `__any__` sentinel pattern as Audit Log):
  - Role — `owner | org_admin | farm_manager | supervisor | caretaker | veterinarian | biosecurity_qa | maintenance | inventory | logistics | auditor | support` plus "Any role". Use the `ROLES` constant from `@/lib/auth/permissions`.
  - Status — `active | invited | suspended | expired` plus "Any status".
  - Scope — three selects (site / zone / house) chained, the Audit Log style isn't quite right — collapse to a single `Search scopes` text input that filters against `MemberScope` rows. Simpler, fewer moving parts.
- Search input (full-width on mobile, `w-64` on `sm+`) for `displayName`, `email`, or scope text. Same `pl-7` icon positioning.
- Conditional `Clear (n)` button — same `variant="ghost"` + `X` icon treatment.

State is URL-bound the same way Audit Log does it: `role`, `status`, `query`, `scope`, `row` keys in `searchParams`. `role` filters by `member.role`; `status` filters by `member.status`; `query` is substring-matched across name + email + scope text; `scope` is substring-matched against `MemberScope` joined string; `row` selects which member's Sheet is open.

A summary row underneath shows `Showing N of M members · newest first`.

### 3. Timeline rows

Mirror of Audit Log's timeline (`audit-log-client.tsx` lines 340–445).

- Outer: `<ol className="space-y-6">` of buckets.
- Each bucket (`<li>`):
  - Sticky header `<div className="sticky top-0 z-10 -mx-4 mb-3 flex items-baseline gap-3 bg-background/85 px-4 py-1 backdrop-blur supports-[backdrop-filter]:bg-background/65">`:
    - `h2.text-sm.font-semibold` with bucket label.
    - Mono count badge: `N members`.
- Bucket list `<ul className="relative ml-3 border-l border-border/70">`:
  - Each `<li className="relative pl-6">` has a tone-coloured rail dot at `left-0 top-3.5 size-2 -translate-x-1/2 rounded-full ring-4 ring-background`.
- Tone classes (re-use the Audit Log's `toneClasses` helper, generalised):
  - `active` → `bg-emerald-500`
  - `invited` (or pending invite) → `bg-amber-500`
  - `suspended` → `bg-destructive`
  - `expired` → `bg-muted-foreground/50`
  - `recent_login` (logged in within last 24h, optional signal) → `bg-sky-500`
- Row button `<button>` (the Audit Log row shape) with:
  - Mono date column `w-20`: `Joined 2026-07-11` / `2d ago` (use `formatBucketLabel` + a `formatJoinBucketDate` helper).
  - Member cell:
    - Name (semibold) + email (mono, copy-on-click like Audit Log's `<Copyable>`).
    - Tone pill (`Active` / `Invited` / `Suspended`) using the same small uppercase tracked classes.
    - Role `<Badge variant="outline">` and scope summary: `Scoped to: Site A · Zones 1–4` or `No scope set` muted.
  - Right `<ChevronRight className={`size-4 ${open ? "rotate-90" : ""}`}>`.

Bucketing rule (same logic as `bucketize` in audit-log-client):
- `today`, `yesterday`, `this week`, `this month`, `earlier` — exact "Earlier this week" / "Earlier this month" labels are computed from ISO date math, not calendar week numbers.
- Empty buckets are skipped.

### 4. Sheet detail

Re-uses `Sheet` from `@/components/ui/sheet` with `side="right"` and `className="flex w-full flex-col gap-0 sm:max-w-xl"`, same as Audit Log's `SheetContent` style.

Sections (top → bottom):

- **Header strip** — name as `<h2 className="text-lg font-semibold">`, status pill + mono full join date, close button.
- **Identity fields** — `Email` (mono, copyable), `Role` (Badge), `Status` (Badge), `Joined`, `Last seen` (if available from audit log), `Invited by` (if available).
- **Scope list** — list of `MemberScope` rows: site / zone / house chip + optional `permission` + optional `expiresAt`. Fetched via existing `listScopesForMember` (introduce helper if missing — see "Server data" below).
- **Effective capabilities** — flat list of granted capability labels for `can(role, capability)` where `granted === true`. Group under a single `Effective access` heading with a list of muted code chips. Pure render from existing `can()` helper, no server round-trip.
- **Recent activity** — top 5 `AuditLogEntry` rows for `actorUserId === member.userId`, fetched server-side and rendered with a slimmed audit-log row (timestamp + event type pill + reason). If the events list is empty, show the Audit Log's `EmptyState` shape ("No recent activity for this member").
- **Footer note** — `Editing roles and revoking members lives in the Roles & permissions section.` with a link (button-as-anchor) to the existing roles management entry point. We will not add a new tab mechanism this round — see Open Questions.

`row=` query param controls which Sheet is open; toggling is the same as Audit Log.

### 5. Empty / error states

- Members list empty → `EmptyState` shape identical to Audit Log (`ShieldAlert` icon, "No members match", "Try clearing filters or widening the search query.").
- Server error on `listMembers` → page-level error message in a `bg-destructive/5 border-destructive/30` banner (mirrors the AlertTriangle banner in `RolesPageClient` lines 511–523).

## Architecture / files

### New component

- `src/features/identity-access/components/users-page-client.tsx` — `"use client"` component, hosts filter state + Sheet state, mirrors the architecture of `audit-log-client.tsx`.
  - Props: `{ members: MemberRow[]; invitations: Invitation[]; filters: { roles: Role[]; statuses: MemberStatus[]; }; active: { role: string; status: string; query: string; scope: string; rowId: string } }`.
  - Internal state: `now` snapshot for relative times, `useTransition` + URL updates.
  - Memoised: filtered members, buckets, flat list, selected member.

### New (or extended) data layer

- `src/features/identity-access/server/queries.ts` — add:
  - `listMembers(orgId, opts)` — already exists per `roles/page.tsx` import. If pagination / filter pipe not present, extend it to accept `{ role?, status?, q? }` and return `{ rows, total }`.
  - `listScopesForMembers(orgId)` — new helper that returns `Array<MemberScope & { memberId: string }>`. Keeps query central, allows the page to join at render time. Only called server-side.
  - `listRecentActivityForUser(orgId, userId, limit)` — wraps existing `listAuditLog({ actorUserId: userId, limit: 5 })`. If `listAuditLog` doesn't accept `actorUserId`, add that filter (1-line addition).

  Each helper follows the existing patterns: `requireUserOrRedirect`, return ActionResult-shaped data, RLS-bound through the existing security definer views/policies.

- `src/features/identity-access/lib/users-page-model.ts` — pure functions (mirror of `lib/capability-matrix.ts` shape):
  - `bucketize(members)` — given `MemberRow[]`, group by day, return `Array<{ key, label, rows }>`. Sort newest first.
  - `formatBucketLabel(date)` — re-export or copy from audit-log (the two become dupe code; acceptable, both files are small).
  - `filterMembers(members, scopes, active)` — pure filter pass.
  - `classifyMemberStatus(status)` — `{ label, tone }` mapping for the row's tone pill.

### Page (server, replace existing)

- `src/app/(dashboard)/[organizationSlug]/settings/roles/page.tsx`:
  - Reads `searchParams` for `role | status | query | scope | row`.
  - Calls `listMembers(orgId, { role: sp.role, status: sp.status, q: sp.query, scope: sp.scope })` for the filtered set.
  - Calls `listInvitations(orgId)` (existing helper) for the Pending-invites stat tile.
  - Calls `listScopesForMembers(orgId)` once.
  - For the Sheet's `rowId`, calls `listRecentActivityForUser(orgId, member.userId, 5)` lazily.
  - Renders: `<header>` + `<UsersPageClient ... />` only — drops all editorial components.

### Components kept (not rendered this round)

- `src/features/access-control/components/{roles-masthead,capability-matrix,role-roster,rank-ladder,invitations-queue}.tsx` — left in place; future iterations may add an `?view=analytics` toggle that surfaces them. Tests in `tests/unit/*.test.ts` remain valid.

## Visual / interaction details

- Spacing scale: `px-4 py-6 sm:px-6 lg:px-8` for the page (matches Audit Log).
- Card radius: `rounded-xl` for the filter card, `rounded-lg` for stat tiles. Same tokens Audit Log uses.
- Mono font (`font-mono tabular-nums`) reserved for: dates, counts, capability codes, email fragments.
- Display font (`var(--font-display)`) NOT used on this page — that is the editorial tone we are leaving. Plain sans for all headings.
- Tone pill colours re-use the `toneClasses` helper pattern from Audit Log (already in this skill file's scope).
- No new CSS variables, no new tokens.

## Accessibility

- Filter selects: all have labelled `<SelectValue placeholder>` and visible focus rings (existing component supplies these).
- Sheet: `SheetTitle` is `sr-only` to avoid duplicate screen-reader headings; the visible heading is the member's name.
- Tone dots have `aria-hidden`; the screen-reader signal is the pill text (`Active`, `Invited`, etc.).
- Bucket headers (`<h2>`) and member rows (`<button aria-expanded>`) match Audit Log's exact ARIA pattern.
- Buttons reachable via Tab order: Filter selects → search input → Clear → first row → next row → chevron.

## Testing

- Unit tests (Vitest) for the pure helpers in `users-page-model.ts`:
  - `bucketize` — Today's row + yesterday + this-month + earlier; empty list; single-element list.
  - `filterMembers` — role/status/query/scope filters; multi-filter intersection.
  - `classifyMemberStatus` — all four statuses + unknown.
- Component test (Vitest + Testing Library) on `UsersPageClient` mirroring `tests/unit/dashboard-shell-model.test.ts` style:
  - Renders a known members list → matches snapshot of bucket headers and first row.
  - Filter selects update URL params (mock router).
  - Sheet opens on row click and renders the member's effective capabilities from a stub.
- No new Playwright tests this round — `/settings/roles` already has no dedicated e2e and the Audit Log e2e is the closest analogue.

## Migration / rollout

- This is a single-page rewrite. No data, no API changes.
- Old components (`RolesMasthead` etc.) stay in code. If we want to delete later, that is a separate PR.
- No backwards-compatibility shims required.

## Open questions

None for this round. Future iterations may want:
- An "analytics" view that re-surfaces `RankLadder` + `RoleRoster` in the sidebar.
- Bulk actions on the timeline rows (revoke / change role) — would require promoting some `RolesPageClient` logic to a shared module.
- Real "Last seen" data — depends on whether login events are recorded in the audit log today (verify in queries layer).
