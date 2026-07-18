# Roles & Permissions — Editorial Redesign (2026-07-11)

## Goal

Replace the placeholder `<table>` on `/settings/roles` with a production-grade
**editorial** interface that:

1. **Reads** the live capability matrix (`@/lib/auth/permissions.ts`) and live
   membership data (`listMembers`, `listInvitations`) from Supabase.
2. **Visually** treats the matrix as a heatmapped spread — roles ranked by
   weight on the Y axis, capabilities grouped by category on the X axis —
   rather than a CRUD-style grid.
3. **Stays** read-only in this PR (editing is owned by MOD-19).

## Aesthetic direction

**Editorial / magazine spread** — typographic masthead, asymmetric two-column
composition, safety-orange single accent, hairline rules, generous whitespace.

**Type**
- `DM Serif Display` — masthead headline, role-rank ladder labels, kicker.
- `Poppins` — body, UI labels (already in `--font-ui`).
- Existing mono — capability code labels (`audit.read`).

**Color**
- Base: existing `oklch(1 0 0)` background, near-black foreground.
- Accent: `oklch(0.65 0.19 50)` (safety orange, matches poultry operations).
- Hairlines: `--border` at 50% opacity.

**Layout**
```
┌─────────────────────────────────────────────────────────────┐
│  MASTHEAD  ROLES & PERMISSIONS                              │
│            13 roles · 16 capabilities · last revised …      │
├──────────────────────────────────┬──────────────────────────┤
│  THE MATRIX (heatmap grid)       │  ROLE ROSTER (live)      │
│  rows = roles ranked             │  counts per role         │
│  cols = capabilities by category │                          │
├──────────────────────────────────┤  RANK LADDER             │
│  THE INVITATIONS QUEUE (live)    │  bar chart 0–100         │
└──────────────────────────────────┴──────────────────────────┘
```

## Architecture

### Files created

| Path | Type | Purpose |
|---|---|---|
| `src/features/access-control/lib/group-capabilities.ts` | pure | Group 16 `Capability`s into 6 categories |
| `src/features/access-control/lib/group-capabilities.test.ts` | vitest | TDD: grouping correctness |
| `src/features/access-control/lib/capability-matrix.ts` | pure | Normalize the matrix data for the UI |
| `src/features/access-control/lib/capability-matrix.test.ts` | vitest | TDD: matrix cell data |
| `src/features/access-control/components/roles-masthead.tsx` | server | Masthead block (server component, no client hooks) |
| `src/features/access-control/components/capability-matrix.tsx` | server | Heatmap grid (server) |
| `src/features/access-control/components/role-roster.tsx` | server | Role → live member count (server) |
| `src/features/access-control/components/rank-ladder.tsx` | server | Vertical rank visualization (server) |
| `src/features/access-control/components/invitations-queue.tsx` | server | Pending invitations block (server) |

### Files modified

| Path | Change |
|---|---|
| `src/app/(dashboard)/[organizationSlug]/settings/roles/page.tsx` | Replace `<table>` with editorial layout, accept `organizationSlug` param, call Supabase queries |
| `src/app/globals.css` | Add `DM Serif Display` `@font-face`, expose `--font-display` CSS variable |
| `src/lib/auth/permissions.ts` | Export `roleRank` so the visual ladder and grant rule can share one source |

### Data flow

```
Server Component (page)
 ├─ getOrganizationBySlug(slug)        → org name
 ├─ listMembers(org.id)               → OrganizationMember[]   (live roster counts)
 ├─ listInvitations(org.id)           → Invitation[]           (live invitations queue)
 └─ render editorial layout
     ├─ Masthead                       (static; org name + counts)
     ├─ <CapabilityMatrix caps={…} roles={…}/>      (pure)
     │    uses can(role, capability) → heatmap cells
     ├─ <RoleRoster members={…}/>      (pure; grouping)
     ├─ <RankLadder/>                  (pure; reads roleRank)
     └─ <InvitationsQueue invites={…}/> (pure; filters pending)
```

All rendering happens server-side. **No new client components.**
The page is fully RLS-respected because it uses the per-request Supabase client.

### Capability groupings (6)

| Category | Capabilities |
|---|---|
| Organization | `organization.manage`, `organization.settings.update` |
| Membership | `membership.invite`, `membership.role.change`, `membership.scope.change`, `membership.deactivate` |
| Access review | `access_review.run`, `access_review.decide` |
| Support | `support_session.open`, `support_session.end` |
| Break-glass | `break_glass.open`, `break_glass.finalize` |
| Audit & Auth | `audit.read`, `audit_log.read`, `auth_security.read`, `step_up.reauth` |

## Tests (TDD)

1. `group-capabilities.test.ts`
   - `groupCapabilities(CAPABILITIES)` returns 6 groups with expected labels
   - Total number of capabilities across all groups equals `CAPABILITIES.length`
   - Every input capability appears in exactly one group

2. `capability-matrix.test.ts`
   - `buildMatrix({roles, capabilities, group})` returns rows sorted by `roleRank` descending
   - Each cell exposes `{ hasCapability: boolean }`
   - `hasCapability` matches `can(role, capability)` for every (role, capability) pair
   - Empty-role rows include all capability cells with `hasCapability: false`

## Out of scope (YAGNI)

- Editing the matrix (MOD-19)
- Dark-mode variant beyond what existing tokens support
- Animation beyond CSS staggered fade-in on matrix rows
- New shadcn/ui primitives
- New external dependencies
- E2E test (no MOD-01 e2e exists; would set a precedent)
- An i18n pass

## Roll-out

1. Implement TDD tests (`group-capabilities`, `capability-matrix`)
2. Implement pure lib files to make tests pass
3. Implement server components
4. Replace `page.tsx`
5. Add `@font-face` for `DM Serif Display`
6. Run `npm run lint`, `npm run typecheck`, `npm test`
7. Manual smoke: log in as `owner@gmail.com` → navigate to
   `/ayam-norliza/settings/roles`; verify masthead, matrix, roster, ladder, queue

## Reference

- `src/lib/auth/permissions.ts` — capability matrix, role rank, grant rules
- `src/features/identity-access/server/queries.ts` — `listMembers`,
  `listInvitations`, `getOrganizationBySlug`
- `src/features/dashboard/components/dashboard-shell-model.ts` — sidebar
  route registration (Roles already registered, no change needed)
- `MOD-01 §6.7` (perms comment): users may never grant a role broader than
  their own — reflected in `canGrantRole()` and the rank ladder visual.
