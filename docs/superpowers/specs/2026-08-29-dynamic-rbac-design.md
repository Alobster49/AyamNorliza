# Dynamic RBAC — custom roles + per-page CRUD permissions

**Date:** 2026-08-29
**Status:** Approved design
**Scope:** One pass — schema, editable Roles & Permissions page, and full enforcement across app + RLS.

## Goal

Replace the hardcoded 7-role / 17-capability model with database-driven roles and
permissions:

- Admins can **create, rename, and delete custom roles** per organization.
- Each role gets **per-page CRUD grants** (view / add / edit / delete) plus a
  separate **Administration** section of special capability toggles.
- The Roles & Permissions page (`settings/roles`) becomes the editor, accessible
  to owner + org_admin only (via a `roles` resource permission, not hardcoded
  role names).
- Every existing enforcement point — page guards, server actions, RPCs, RLS
  policies, nav, client buttons — checks the new permission tables. No
  app-side-only enforcement.

## Decisions made

| Question | Decision |
|---|---|
| Custom roles | Full custom roles: new `organization_roles` table, `organization_members.role` becomes FK. |
| Granularity | CRUD per page (view/add/edit/delete) + Administration capability toggles. |
| Resource list | Auto-derived from existing nav sections (canonical constant in code). |
| Built-in roles | Protected shell: 7 system roles can't be renamed/deleted; their grants are editable. Owner role fully locked (all granted). |
| Enforcement | Full enforcement in this pass — app guards AND SQL/RLS. |
| Old 17 capabilities | Kept as "Administration" toggles in the same editor/table (`action = 'use'`). |
| Decomposition | One spec, one implementation plan (user's explicit choice). |

## Schema

### `organization_roles`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| organization_id | uuid fk → organizations | |
| key | text | slug, unique per org (e.g. `seller`, `night-shift-lead`) |
| name | text | display name |
| description | text nullable | |
| rank | int | privilege ladder; grant checks use rank comparison |
| is_system | bool | true for the 7 seeded built-ins |
| created_at / updated_at | timestamptz | |

- Seed the 7 built-ins (`owner`, `org_admin`, `hr`, `seller`, `supervisor`,
  `inventory`, `driver`) for every existing org; seed on new-org creation too
  (same path that creates the owner membership).
- `owner` role: undeletable, un-renameable, permissions locked to all-granted.
- System roles: rename/delete blocked (DB trigger + server action + UI);
  permission grants editable.
- Custom roles: fully editable; delete blocked while any active member holds
  the role.

### `role_permissions`

| Column | Type | Notes |
|---|---|---|
| role_id | uuid fk → organization_roles (cascade) | |
| resource | text | resource key or capability key |
| action | text | check in (`view`,`add`,`edit`,`delete`,`use`) |
| granted | bool | |
| unique (role_id, resource, action) | | |

- Page permissions use `view/add/edit/delete`.
- Administration capabilities use `action = 'use'` with `resource` = capability
  key (e.g. `membership.invite`, `break_glass.open`, `orders.reopen`,
  `data_console.manage`). One table, two UI sections.
- Rule: `add/edit/delete` require `view`; revoking `view` clears the rest
  (enforced in server action; UI mirrors it).

### `organization_members`

- Add `role_id uuid fk → organization_roles`.
- Backfill from existing `role` text.
- Keep `role` text column synced by trigger during the transition (so any
  unmigrated reader keeps working mid-deploy); drop the column + trigger in a
  final cleanup migration once the sweep is complete.
- Same treatment for `invitations.role`.

### Retired

- `role_capability_overrides` table: existing per-org override rows folded into
  the seeded `role_permissions`, then table dropped.
- Hardcoded `matrix` / `can()` in `src/lib/auth/permissions.ts`: replaced by
  DB resolution.
- Legacy SQL role values `logistics` and `farm_manager` (still referenced in
  RPCs / one RLS policy): cleaned up in the same migration.

## Resources (canonical list, from nav inventory)

`dashboard, products, orders, customers, market_prices, dispatch,
delivery_runs, delivery_setup, warehouse_tasks, loading, driver_deck, leave,
leave_management, users, roles, data_console, settings`

Defined once as a `RESOURCES` const in `src/lib/auth/permissions.ts` (replacing
the old capability list). Each nav item in the dashboard shell model declares
its resource key; adding a page later = one constant + one nav entry.

## Administration capabilities (carried over)

`organization.manage, organization.settings.update, membership.invite,
membership.role.change, membership.scope.change, membership.deactivate,
access_review.run, access_review.decide, break_glass.open,
break_glass.finalize, audit.read, audit_log.read, auth_security.read,
step_up.reauth, orders.reopen, data_console.manage`

(`catalog.manage`, `orders.manage`, `customers.manage` are subsumed by page
CRUD on `products` / `orders` / `customers` and retired. `orders.reopen` is
new — previously an inline owner/org_admin check. `data_console.manage`
replaces the literal `["org_admin"]` guard.)

## Enforcement — SQL layer

### `has_permission(target_org uuid, p_resource text, p_action text) returns boolean`

`security definer`. Checks: caller has an active, unexpired membership in
`target_org` → joins member's `role_id` → `role_permissions` row with
`granted = true`. Role with key `owner` short-circuits true.

### Rewrites

Every `has_org_role(org, array[...])` call site becomes `has_permission`:

| Current | New check |
|---|---|
| `place_order` / `confirm_order` / `close_order` / `cancel_order` | `('orders','add')` for place; `('orders','edit')` for the rest |
| `reopen_order` | `('orders.reopen','use')` |
| `complete_order_task` / `claim_weigh_task` | `('warehouse_tasks','edit')` |
| `set_run_status` / dispatch RPCs | `('dispatch','edit')` |
| `dispatch_set_loaded` / `dispatch_claim_loading` | `('loading','edit')` |
| `can_record_stop` | `('driver_deck','edit')` OR assigned driver (unchanged OR-branch) |
| `admin_clear_org_data` | `('data_console.manage','use')` |
| `get_dashboard_*` | `('dashboard','view')` |
| leave approver RPCs (`approve_leave_request` etc.) | `('leave_management','edit')` |
| `leave_available` | `('leave_management','view')` OR self |
| RLS: org update/delete | `('organization.manage','use')` |
| RLS: members/invitations admin write | `('membership.invite','use')` / `('membership.role.change','use')` as appropriate |
| RLS: access_reviews | `('access_review.run','use')` |
| RLS: leave tables approver write/read | `('leave_management','edit')` / `('leave_management','view')` |
| RLS: `organization_roles` / `role_permissions` select | any active member (nav needs it) |
| RLS: `organization_roles` / `role_permissions` write | `('roles','edit')` |

`has_org_role` is kept as a deprecated shim (resolves role key via `role_id`
join) so nothing breaks mid-migration; dropped in the final cleanup migration.

## Enforcement — application layer

### New guard

`requirePermission(organizationSlug, resource, action)` in `src/lib/auth/`
(same shape as `requireOrgRole`: authenticates, loads org + membership,
resolves permission, throws `OrderPermissionError` → `notFound()`).
`requireRoleOrRedirect` gets a `requirePermissionOrRedirect` sibling.

`resolvePermissionsForOrg(orgSlug)` loads the caller's full grant set in one
query, cached per request (React `cache()`), for nav + client props.

### Call-site sweep (from inventory)

- 13 page guards under `(seller)` + `(dashboard)` route groups → resource
  `view` checks (e.g. products page → `('products','view')`, data-console →
  `('data_console.manage','use')`).
- Wrapper guards rewritten to take `(resource, action)`:
  `guardRoles` (order-actions, ~20 sites), `guardRoles` (facility-actions,
  8 sites), `guardDispatch` (8 sites), HR `requireLeaveApprover` /
  `requireMember`, `analytics-actions`, `schedule-actions`, `driver-actions`.
  Mutations map to `add`/`edit`/`delete` by what they do (create order = add,
  status moves = edit, deletes = delete).
- Role-constant files (`orders/lib/roles.ts`, `logistics/lib/roles.ts`,
  `hr/lib/roles.ts`) deleted once no importer remains.
- `identity-access` capability checks (`can(actor, 'membership.invite')` etc.)
  re-pointed at DB-resolved grants; `canGrantRole` reworked to compare
  `organization_roles.rank` (can't grant rank ≥ your own).
- Landing redirect (`landing.ts`): pick the first nav item the member can
  `view`, ordered by the nav model, instead of the role switch.
- Nav (`dashboard-shell-model.ts`): each item declares `resource`; groups are
  filtered by the resolved permission set. Role-branch constants deleted.
  Layouts pass the permission set instead of `role`.
- Client gates become server-derived props: delivery `canEdit` →
  `('delivery_setup','edit')`; order reopen → `('orders.reopen','use')`
  (board-rules + order-detail); role pickers (invite/create/edit user dialogs)
  list `organization_roles` filtered by rank.

## Roles & Permissions page (editor)

Route: `settings/roles` (existing). Keep the editorial masthead visual style.

- Gate: page requires `('roles','view')`; mutations require `('roles','edit')`.
  Seeded grants: owner + org_admin only. (This is the "admin and owner only"
  requirement, but expressed as a permission so it stays consistent.)
- **Left rail — role list:** system roles (badged) ranked first, custom roles
  below, member count per role, "New role" button → dialog: name, optional
  clone-from role (copies grants), rank auto-set below creator's rank.
- **Main panel — selected role:**
  - Header: name (inline-editable for custom roles), description, rank,
    delete button (custom roles only; disabled with reason while members hold
    the role).
  - **Pages** section: grid of resource rows × view/add/edit/delete toggles.
    Toggling obeys the view-dependency rule. Owner row read-only (all on).
  - **Administration** section: capability toggles, grouped as today
    (Organization / Membership / Access Review / Break-glass / Audit & Auth).
  - "Reset to defaults" for system roles (restores seeded grants).
- Server actions (in `identity-access`, replacing the MOD-19 stub
  `getRolesView` / `updateRoleCapabilityAction` / `resetRoleToDefaultsAction`):
  `createRoleAction`, `renameRoleAction`, `deleteRoleAction`,
  `setPermissionAction`, `resetRoleToDefaultsAction`. Each re-checks
  `('roles','edit')` server-side; RLS backs them up.
- The old read-only `access-control` components (`capability-matrix`,
  `role-roster`, `rank-ladder`, `invitations-queue`): matrix replaced by the
  editor; roster/invitations retained if they fit the new layout, otherwise
  dropped (implementation plan decides; no new features added to them).

## Migration order

1. Migration A: create `organization_roles` + `role_permissions`, seed
   built-ins per org from the current hardcoded matrix + fold in
   `role_capability_overrides`, add `organization_members.role_id` +
   `invitations.role_id` backfill + sync triggers, create `has_permission`,
   new-org seeding hook, RLS for the new tables.
2. Migration B: rewrite all RPCs + RLS policies to `has_permission`; clean up
   `logistics` / `farm_manager` leftovers.
3. App sweep ships in the same deploy (guards, nav, client props, editor UI).
4. Migration C (cleanup, after verification): drop `role` text columns, sync
   triggers, `has_org_role`, `role_capability_overrides`.

## Testing

- **Seed-parity snapshot test:** for all 7 roles × every old capability +
  derived page grant, seeded `role_permissions` must equal the old `can()`
  matrix results. This is the no-regression gate for the migration.
- **Guard tests:** `requirePermission` unit tests (member without grant →
  throws; owner → passes; expired membership → throws).
- **RLS/RPC tests:** existing SQL test patterns — e.g. seller without
  `('orders','add')` cannot `place_order`.
- **e2e smoke** with seeded accounts (`password123` per project convention):
  - seller: revoke `('products','delete')` → delete button gone AND server
    action rejected.
  - custom role: create "viewer" (view-only on products/orders), assign to a
    test member, verify nav shows only those pages and mutations 403.
  - hr / worker / driver logins land on their expected pages (landing logic).
- Existing e2e suite run before deploy (repo convention: label coupling —
  check `repo-gotchas`).

## Out of scope

- Per-member (not per-role) permission overrides.
- Scoped permissions (per-facility, per-region) — `member_scopes` untouched.
- Buyer portal auth (separate system).
- Multiple roles per member.
