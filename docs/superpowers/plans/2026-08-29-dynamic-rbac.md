# Dynamic RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded 7-role capability matrix with DB-driven roles (`organization_roles`) and per-page CRUD permissions (`role_permissions`), an editable Roles & Permissions page, and full enforcement across app guards, nav, client gates, RPCs, and RLS.

**Architecture:** Two new tables per org (roles + grants) seeded from the current hardcoded matrix; one SQL primitive `has_permission(org, resource, action)` replaces `has_org_role` in RLS/RPCs; one TS primitive `requirePermission(slug, resource, action)` replaces `requireOrgRole` in guards. UI: `settings/roles` becomes an editor (role list + Pages CRUD grid + Administration toggles). Spec: `docs/superpowers/specs/2026-08-29-dynamic-rbac-design.md`.

**Tech Stack:** Next.js (App Router, server actions), Supabase (Postgres + RLS, `security definer` functions), Vitest, next-intl.

## Global Constraints

- Actions: `view`, `add`, `edit`, `delete` for pages; `use` for administration capabilities. `add/edit/delete` require `view` (server action clears them when `view` is revoked).
- 7 system roles (`owner, org_admin, hr, seller, supervisor, inventory, driver`): cannot be renamed or deleted; grants editable — EXCEPT `owner`, whose grants are fully locked.
- **Spec deviation (approved rationale):** `has_permission` has **no owner short-circuit**. Owner grants are seeded explicitly as all-granted **except** `data_console.manage` — today the data console is org_admin-only (owner excluded, see CLAUDE.md); an unconditional short-circuit would silently widen owner access. Owner row is UI-locked, not SQL-implied.
- Seeded grants MUST reproduce today's access exactly (parity test in Task 2 is the regression gate). No role gains or loses access from the migration alone.
- Test accounts always use password `password123` (project CLAUDE.md).
- New tables need explicit grants (`repo-gotchas` memory: grants-on-new-tables) — every new table gets `grant select, insert, update, delete on ... to authenticated;` in its migration.
- i18n: all new UI strings added to `src/messages/en.json` AND `src/messages/ms.json` (and `en.d.json.ts` if the repo's type-gen requires manual entry — check how the last keys were added).
- Migration numbering continues from `20260831000001_role_realignment.sql` → use `20260901…` prefixes.
- Run `npx vitest run <file>` for unit tests; full gate before finishing: `npx vitest run && npx tsc --noEmit` (or the repo's `npm run` equivalents — check `package.json` scripts first and prefer them).

## Canonical data (used by several tasks — copy exactly)

**Resources** (17): `dashboard, products, orders, customers, market_prices, dispatch, delivery_runs, delivery_setup, warehouse_tasks, loading, driver_deck, leave, leave_management, users, roles, data_console, settings`

**Administration capabilities** (15): `organization.manage, organization.settings.update, membership.invite, membership.role.change, membership.scope.change, membership.deactivate, access_review.run, access_review.decide, break_glass.open, break_glass.finalize, audit.read, audit_log.read, auth_security.read, orders.reopen, data_console.manage`

Notes: `catalog.manage`/`orders.manage`/`customers.manage` retired (subsumed by page CRUD). `step_up.reauth` retired as a grant — it was non-overridable and held by every non-driver role; the step-up reauth flow keys off authentication (AAL2), not a stored grant, so drop it from the permission model entirely (verify: grep `step_up.reauth` usages and re-point them per Task 7). `orders.reopen` and `data_console.manage` are new.

**Default grants per system role** (the parity source of truth; also the SQL seed):

| Role (rank) | Pages | Administration |
|---|---|---|
| owner (100) | ALL resources except `data_console`: view+add+edit+delete | all capabilities except `data_console.manage` |
| org_admin (80) | ALL resources: view+add+edit+delete | all capabilities |
| hr (75) | leave: v/a/e/d; leave_management: v/a/e/d | — |
| seller (60) | products, orders, customers, market_prices, dispatch, delivery_runs: v/a/e/d; delivery_setup: v; loading: e (no v — RPC-only, see Task 4); leave: v/a | — |
| supervisor (60) | identical to seller | — |
| inventory (40) | warehouse_tasks: v/e; loading: v/e; leave: v/a | — |
| driver (30) | driver_deck: v/e; leave: v/a | — |

(`leave: v/a` = members can view/submit their own leave; approver powers live under `leave_management`. Self-scoped RLS on leave tables is untouched.)

---

### Task 1: TS canonical model + parity test

**Files:**
- Create: `src/lib/auth/rbac.ts`
- Test: `src/lib/auth/rbac.test.ts`

**Interfaces:**
- Produces: `RESOURCES`, `PAGE_ACTIONS`, `ADMIN_CAPABILITIES`, types `Resource`, `PageAction`, `AdminCapability`, `PermissionAction`, `PermissionKey` (`` `${string}:${PermissionAction}` ``), `DEFAULT_ROLE_GRANTS: Record<SystemRoleKey, ReadonlySet<PermissionKey>>`, `SYSTEM_ROLES: readonly { key, rank }[]`, helper `grantKey(resource, action)`.
- Consumed by: Tasks 2 (SQL seed mirrors it), 3 (guard), 8 (nav), 10 (editor actions).

- [ ] **Step 1: Write the failing parity test**

```ts
// src/lib/auth/rbac.test.ts
import { describe, expect, it } from "vitest";
import { can, ROLES, type Role } from "./permissions";
import {
  ADMIN_CAPABILITIES,
  DEFAULT_ROLE_GRANTS,
  PAGE_ACTIONS,
  RESOURCES,
  SYSTEM_ROLES,
  grantKey,
} from "./rbac";

// Maps each page a role can open today to the old checks that granted it.
// This test is the no-regression gate: seeded grants == today's access.
const LEGACY_PAGE_ACCESS: Record<string, readonly Role[]> = {
  dashboard: ["owner", "org_admin"],
  products: ["owner", "org_admin", "seller", "supervisor"],
  orders: ["owner", "org_admin", "seller", "supervisor"],
  customers: ["owner", "org_admin", "seller", "supervisor"],
  market_prices: ["owner", "org_admin", "seller", "supervisor"],
  dispatch: ["owner", "org_admin", "seller", "supervisor"],
  delivery_runs: ["owner", "org_admin", "seller", "supervisor"],
  delivery_setup: ["owner", "org_admin", "seller", "supervisor"],
  warehouse_tasks: ["owner", "org_admin", "inventory"],
  loading: ["owner", "org_admin", "inventory"],
  driver_deck: ["owner", "org_admin", "driver"],
  leave: [...ROLES],
  leave_management: ["owner", "org_admin", "hr"],
  users: ["owner", "org_admin"],
  roles: ["owner", "org_admin"],
  data_console: ["org_admin"],
  settings: ["owner", "org_admin"],
};

describe("DEFAULT_ROLE_GRANTS parity with legacy access", () => {
  it("covers every resource", () => {
    expect(Object.keys(LEGACY_PAGE_ACCESS).sort()).toEqual([...RESOURCES].sort());
  });

  for (const resource of Object.keys(LEGACY_PAGE_ACCESS)) {
    for (const { key: role } of SYSTEM_ROLES) {
      it(`${role} view on ${resource} matches legacy`, () => {
        const legacy = LEGACY_PAGE_ACCESS[resource].includes(role as Role);
        const seeded = DEFAULT_ROLE_GRANTS[role].has(grantKey(resource, "view"));
        expect(seeded).toBe(legacy);
      });
    }
  }

  it("carries over legacy admin capabilities", () => {
    for (const cap of ADMIN_CAPABILITIES) {
      if (cap === "orders.reopen" || cap === "data_console.manage") continue;
      for (const { key: role } of SYSTEM_ROLES) {
        const seeded = DEFAULT_ROLE_GRANTS[role].has(grantKey(cap, "use"));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(seeded, `${role}/${cap}`).toBe(can(role as Role, cap as any));
      }
    }
    // New capabilities preserve today's inline owner/org_admin checks:
    expect(DEFAULT_ROLE_GRANTS.owner.has(grantKey("orders.reopen", "use"))).toBe(true);
    expect(DEFAULT_ROLE_GRANTS.org_admin.has(grantKey("orders.reopen", "use"))).toBe(true);
    expect(DEFAULT_ROLE_GRANTS.owner.has(grantKey("data_console.manage", "use"))).toBe(false);
    expect(DEFAULT_ROLE_GRANTS.org_admin.has(grantKey("data_console.manage", "use"))).toBe(true);
  });

  it("add/edit/delete imply view", () => {
    for (const { key: role } of SYSTEM_ROLES) {
      for (const resource of RESOURCES) {
        for (const action of ["add", "edit", "delete"] as const) {
          if (DEFAULT_ROLE_GRANTS[role].has(grantKey(resource, action))) {
            // Known exception: seller/supervisor hold loading:edit RPC-only.
            if (resource === "loading" && (role === "seller" || role === "supervisor")) continue;
            expect(
              DEFAULT_ROLE_GRANTS[role].has(grantKey(resource, "view")),
              `${role} ${resource}:${action} without view`,
            ).toBe(true);
          }
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run test — must fail** — `npx vitest run src/lib/auth/rbac.test.ts` → FAIL (`rbac.ts` missing).

- [ ] **Step 3: Implement `src/lib/auth/rbac.ts`**

```ts
/**
 * Canonical dynamic-RBAC model. Mirrors the SQL seed in
 * supabase/migrations/20260901000001_dynamic_rbac_schema.sql — keep the two
 * in sync; rbac.test.ts is the parity gate against the legacy matrix.
 */

export const RESOURCES = [
  "dashboard", "products", "orders", "customers", "market_prices",
  "dispatch", "delivery_runs", "delivery_setup", "warehouse_tasks",
  "loading", "driver_deck", "leave", "leave_management", "users",
  "roles", "data_console", "settings",
] as const;
export type Resource = (typeof RESOURCES)[number];

export const PAGE_ACTIONS = ["view", "add", "edit", "delete"] as const;
export type PageAction = (typeof PAGE_ACTIONS)[number];
export type PermissionAction = PageAction | "use";

export const ADMIN_CAPABILITIES = [
  "organization.manage", "organization.settings.update",
  "membership.invite", "membership.role.change", "membership.scope.change",
  "membership.deactivate", "access_review.run", "access_review.decide",
  "break_glass.open", "break_glass.finalize", "audit.read",
  "audit_log.read", "auth_security.read", "orders.reopen",
  "data_console.manage",
] as const;
export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number];

export type PermissionKey = `${string}:${PermissionAction}`;
export function grantKey(resource: string, action: PermissionAction): PermissionKey {
  return `${resource}:${action}`;
}

export const SYSTEM_ROLES = [
  { key: "owner", rank: 100 },
  { key: "org_admin", rank: 80 },
  { key: "hr", rank: 75 },
  { key: "seller", rank: 60 },
  { key: "supervisor", rank: 60 },
  { key: "inventory", rank: 40 },
  { key: "driver", rank: 30 },
] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLES)[number]["key"];

function crud(resource: Resource): PermissionKey[] {
  return PAGE_ACTIONS.map((a) => grantKey(resource, a));
}
function caps(...list: AdminCapability[]): PermissionKey[] {
  return list.map((c) => grantKey(c, "use"));
}

const SELLER_GRANTS: PermissionKey[] = [
  ...(["products", "orders", "customers", "market_prices", "dispatch", "delivery_runs"] as const)
    .flatMap(crud),
  grantKey("delivery_setup", "view"),
  grantKey("loading", "edit"), // RPC-only (dispatch_set_loaded/claim_loading); page stays hidden
  grantKey("leave", "view"), grantKey("leave", "add"),
];

export const DEFAULT_ROLE_GRANTS: Record<SystemRoleKey, ReadonlySet<PermissionKey>> = {
  owner: new Set([
    ...RESOURCES.filter((r) => r !== "data_console").flatMap(crud),
    ...caps(...ADMIN_CAPABILITIES.filter((c) => c !== "data_console.manage")),
  ]),
  org_admin: new Set([...RESOURCES.flatMap(crud), ...caps(...ADMIN_CAPABILITIES)]),
  hr: new Set([...crud("leave"), ...crud("leave_management")]),
  seller: new Set(SELLER_GRANTS),
  supervisor: new Set(SELLER_GRANTS),
  inventory: new Set([
    grantKey("warehouse_tasks", "view"), grantKey("warehouse_tasks", "edit"),
    grantKey("loading", "view"), grantKey("loading", "edit"),
    grantKey("leave", "view"), grantKey("leave", "add"),
  ]),
  driver: new Set([
    grantKey("driver_deck", "view"), grantKey("driver_deck", "edit"),
    grantKey("leave", "view"), grantKey("leave", "add"),
  ]),
};
```

- [ ] **Step 4: Run test — must pass.** If a parity case fails, fix `DEFAULT_ROLE_GRANTS` (or, if the LEGACY table is wrong vs. reality, verify against the actual guard in code before touching the test).
- [ ] **Step 5: Commit** — `git add src/lib/auth/rbac.ts src/lib/auth/rbac.test.ts && git commit -m "feat(rbac): canonical resources, actions, default role grants + legacy parity test"`

---

### Task 2: Migration A — schema, seed, has_permission

**Files:**
- Create: `supabase/migrations/20260901000001_dynamic_rbac_schema.sql`

**Interfaces:**
- Produces: tables `organization_roles`, `role_permissions`; `organization_members.role_id`, `invitations.role_id`; functions `has_permission(uuid, text, text)`, `seed_system_roles(uuid)`; sync triggers keeping `role` text ↔ `role_id`.
- Consumes: `DEFAULT_ROLE_GRANTS` (mirror by hand; grant-for-grant identical to Task 1's table).

- [ ] **Step 1: Read the current patterns.** Read `supabase/migrations/20260831000001_role_realignment.sql` fully (constraint names, `has_org_role` shape) and `20260712000001_role_capability_overrides.sql` (table + grant style). Find where a new organization's owner membership is created (grep migrations + `src/features` for `organization_members` insert on org creation) — the seeding hook in Step 2 must cover that path.

- [ ] **Step 2: Write the migration** (adjust to patterns found in Step 1; this is the required content):

```sql
-- Dynamic RBAC: org-scoped roles + per-page CRUD permissions.
-- Seed mirrors DEFAULT_ROLE_GRANTS in src/lib/auth/rbac.ts (parity-tested).

create table organization_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  rank int not null default 10,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, key)
);

create table role_permissions (
  role_id uuid not null references organization_roles(id) on delete cascade,
  resource text not null,
  action text not null check (action in ('view','add','edit','delete','use')),
  granted boolean not null default true,
  primary key (role_id, resource, action)
);

grant select, insert, update, delete on organization_roles to authenticated;
grant select, insert, update, delete on role_permissions to authenticated;

alter table organization_roles enable row level security;
alter table role_permissions enable row level security;

-- has_permission: active, unexpired member whose role grants (resource, action).
create or replace function has_permission(target_org uuid, p_resource text, p_action text)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1
    from organization_members m
    join role_permissions rp on rp.role_id = m.role_id
    where m.organization_id = target_org
      and m.user_id = auth.uid()
      and m.status = 'active'
      and (m.expires_at is null or m.expires_at > now())
      and rp.resource = p_resource
      and rp.action = p_action
      and rp.granted
  );
$$;

-- RLS: any active member may read (nav needs it); only roles-editors write.
create policy org_roles_select_member on organization_roles for select
  using (exists (select 1 from organization_members m
                 where m.organization_id = organization_roles.organization_id
                   and m.user_id = auth.uid() and m.status = 'active'));
create policy org_roles_write_editor on organization_roles for all
  using (has_permission(organization_id, 'roles', 'edit'))
  with check (has_permission(organization_id, 'roles', 'edit'));
create policy role_perms_select_member on role_permissions for select
  using (exists (select 1 from organization_roles r
                 join organization_members m on m.organization_id = r.organization_id
                 where r.id = role_permissions.role_id
                   and m.user_id = auth.uid() and m.status = 'active'));
create policy role_perms_write_editor on role_permissions for all
  using (exists (select 1 from organization_roles r where r.id = role_permissions.role_id
                   and has_permission(r.organization_id, 'roles', 'edit')))
  with check (exists (select 1 from organization_roles r where r.id = role_permissions.role_id
                   and has_permission(r.organization_id, 'roles', 'edit')));

-- Guard triggers: system roles immutable shell; owner grants locked.
create or replace function protect_system_roles() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system then raise exception 'system roles cannot be deleted'; end if;
    return old;
  end if;
  if old.is_system and (new.key <> old.key or new.name <> old.name or new.is_system <> old.is_system) then
    raise exception 'system roles cannot be renamed';
  end if;
  return new;
end $$;
create trigger organization_roles_protect before update or delete on organization_roles
  for each row execute function protect_system_roles();

create or replace function protect_owner_grants() returns trigger
language plpgsql as $$
declare v_key text;
begin
  select r.key into v_key from organization_roles r
    where r.id = coalesce(new.role_id, old.role_id);
  if v_key = 'owner' and current_setting('rbac.seeding', true) is distinct from 'on' then
    raise exception 'owner grants are locked';
  end if;
  return coalesce(new, old);
end $$;
create trigger role_permissions_protect_owner before insert or update or delete on role_permissions
  for each row execute function protect_owner_grants();

-- Seeder: idempotent; mirrors DEFAULT_ROLE_GRANTS exactly.
create or replace function seed_system_roles(target_org uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  crud text[] := array['view','add','edit','delete'];
  all_caps text[] := array[
    'organization.manage','organization.settings.update','membership.invite',
    'membership.role.change','membership.scope.change','membership.deactivate',
    'access_review.run','access_review.decide','break_glass.open',
    'break_glass.finalize','audit.read','audit_log.read','auth_security.read',
    'orders.reopen','data_console.manage'];
  all_resources text[] := array[
    'dashboard','products','orders','customers','market_prices','dispatch',
    'delivery_runs','delivery_setup','warehouse_tasks','loading','driver_deck',
    'leave','leave_management','users','roles','data_console','settings'];
  seller_crud text[] := array['products','orders','customers','market_prices','dispatch','delivery_runs'];
  r record; res text; act text; cap text;
begin
  perform set_config('rbac.seeding', 'on', true);

  insert into organization_roles (organization_id, key, name, rank, is_system) values
    (target_org, 'owner', 'Owner', 100, true),
    (target_org, 'org_admin', 'Admin', 80, true),
    (target_org, 'hr', 'HR', 75, true),
    (target_org, 'seller', 'Seller', 60, true),
    (target_org, 'supervisor', 'Supervisor', 60, true),
    (target_org, 'inventory', 'Worker', 40, true),
    (target_org, 'driver', 'Driver', 30, true)
  on conflict (organization_id, key) do nothing;

  for r in select id, key from organization_roles
           where organization_id = target_org and is_system loop
    if r.key = 'owner' then
      foreach res in array all_resources loop
        if res <> 'data_console' then
          foreach act in array crud loop
            insert into role_permissions values (r.id, res, act, true) on conflict do nothing;
          end loop;
        end if;
      end loop;
      foreach cap in array all_caps loop
        if cap <> 'data_console.manage' then
          insert into role_permissions values (r.id, cap, 'use', true) on conflict do nothing;
        end if;
      end loop;
    elsif r.key = 'org_admin' then
      foreach res in array all_resources loop
        foreach act in array crud loop
          insert into role_permissions values (r.id, res, act, true) on conflict do nothing;
        end loop;
      end loop;
      foreach cap in array all_caps loop
        insert into role_permissions values (r.id, cap, 'use', true) on conflict do nothing;
      end loop;
    elsif r.key = 'hr' then
      foreach res in array array['leave','leave_management'] loop
        foreach act in array crud loop
          insert into role_permissions values (r.id, res, act, true) on conflict do nothing;
        end loop;
      end loop;
    elsif r.key in ('seller','supervisor') then
      foreach res in array seller_crud loop
        foreach act in array crud loop
          insert into role_permissions values (r.id, res, act, true) on conflict do nothing;
        end loop;
      end loop;
      insert into role_permissions values (r.id, 'delivery_setup', 'view', true) on conflict do nothing;
      insert into role_permissions values (r.id, 'loading', 'edit', true) on conflict do nothing;
      insert into role_permissions values (r.id, 'leave', 'view', true) on conflict do nothing;
      insert into role_permissions values (r.id, 'leave', 'add', true) on conflict do nothing;
    elsif r.key = 'inventory' then
      insert into role_permissions values
        (r.id,'warehouse_tasks','view',true),(r.id,'warehouse_tasks','edit',true),
        (r.id,'loading','view',true),(r.id,'loading','edit',true),
        (r.id,'leave','view',true),(r.id,'leave','add',true)
      on conflict do nothing;
    elsif r.key = 'driver' then
      insert into role_permissions values
        (r.id,'driver_deck','view',true),(r.id,'driver_deck','edit',true),
        (r.id,'leave','view',true),(r.id,'leave','add',true)
      on conflict do nothing;
    end if;
  end loop;
end $$;

-- Seed every existing org, then wire members/invitations to role_id.
do $$ declare o record; begin
  for o in select id from organizations loop
    perform seed_system_roles(o.id);
  end loop;
end $$;

alter table organization_members add column role_id uuid references organization_roles(id);
update organization_members m set role_id = r.id
  from organization_roles r
  where r.organization_id = m.organization_id and r.key = m.role;
alter table organization_members alter column role_id set not null;

alter table invitations add column role_id uuid references organization_roles(id);
update invitations i set role_id = r.id
  from organization_roles r
  where r.organization_id = i.organization_id and r.key = i.role;

-- Transitional sync: writers may still set only `role` (text) or only role_id.
create or replace function sync_member_role_columns() returns trigger
language plpgsql as $$
declare v uuid; v_key text;
begin
  if new.role_id is distinct from old.role_id and new.role_id is not null then
    select key into v_key from organization_roles where id = new.role_id;
    new.role := coalesce(v_key, new.role);
  elsif new.role is distinct from old.role then
    select id into v from organization_roles
      where organization_id = new.organization_id and key = new.role;
    if v is not null then new.role_id := v; end if;
  end if;
  return new;
end $$;
create trigger organization_members_sync_role before insert or update on organization_members
  for each row execute function sync_member_role_columns();
create trigger invitations_sync_role before insert or update on invitations
  for each row execute function sync_member_role_columns();

-- Fold existing per-org overrides into the seeded grants, then retire later
-- (table dropped in the cleanup migration, Task 13).
update role_permissions rp set granted = o.granted
  from role_capability_overrides o
  join organization_roles r on r.organization_id = o.organization_id and r.key = o.role
  where rp.role_id = r.id and rp.resource = o.capability and rp.action = 'use';
insert into role_permissions (role_id, resource, action, granted)
  select r.id, o.capability, 'use', o.granted
  from role_capability_overrides o
  join organization_roles r on r.organization_id = o.organization_id and r.key = o.role
  on conflict do nothing;
```

Then find the new-org creation path from Step 1 and append a call to `seed_system_roles(new_org_id)` there (trigger on `organizations` insert, or patch the existing signup function — follow whichever pattern the repo uses).

- [ ] **Step 3: Apply + verify locally.** `npx supabase db reset` (or the repo's migration command — check how prior sessions applied migrations; `npx supabase migration up` if reset is too destructive with seeds). Then verify with psql:

```bash
npx supabase db reset
```

Expected: applies cleanly. Then:

```bash
psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2-)" -c "select key, count(*) from organization_roles r join role_permissions p on p.role_id=r.id group by key order by 2 desc;"
```

Expected: owner/org_admin with the largest counts; every org has 7 roles; `organization_members.role_id` non-null everywhere.

- [ ] **Step 4: Commit** — `git add supabase/migrations/20260901000001_dynamic_rbac_schema.sql && git commit -m "feat(rbac): organization_roles + role_permissions schema, seed, has_permission"`

---

### Task 3: TS guard — requirePermission + resolver

**Files:**
- Create: `src/lib/auth/require-permission.ts`
- Test: `src/lib/auth/require-permission.test.ts`

**Interfaces:**
- Produces:
  - `requirePermission(organizationSlug: string, resource: string, action: PermissionAction): Promise<PermissionContext>` — throws `OrderPermissionError` (reuse existing class from `src/features/orders/server/guards.ts`) when denied. `PermissionContext = { orgId, userId, roleId, roleKey, timeZone }`.
  - `requirePermissionOrRedirect(...)` — same, redirect fallback (mirror `requireRoleOrRedirect`).
  - `resolvePermissionsForOrg(organizationSlug: string): Promise<{ context: MemberContext | null; grants: ReadonlySet<PermissionKey> }>` — wrapped in React `cache()`; one query for nav + client props.
- Consumes: `grantKey`, `PermissionAction` from `rbac.ts`; `OrderPermissionError`.

- [ ] **Step 1: Write failing tests.** Mirror the mocking pattern used by the existing guard tests (read `src/features/logistics/server/dispatch-actions.test.ts` first and copy its Supabase-mock approach). Cases: no user → throws; member whose grants include `products:view` → passes and returns roleKey; member without grant → throws; `granted=false` row → throws.
- [ ] **Step 2: Run — FAIL.** `npx vitest run src/lib/auth/require-permission.test.ts`
- [ ] **Step 3: Implement.** Same query shape as `requireOrgRole` (org by slug → membership) plus a join: select membership row (`role_id, organization_roles(key)`) then `role_permissions` rows for that `role_id`; check `(resource, action, granted=true)` in the returned set. Keep it two queries max; `resolvePermissionsForOrg` returns the full set as `Set<PermissionKey>` via `grantKey`. Wrap with `import { cache } from "react"`.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(rbac): requirePermission guard + per-request permission resolver"`

---

### Task 4: Migration B — RPC + RLS rewrites

**Files:**
- Create: `supabase/migrations/20260901000002_dynamic_rbac_enforcement.sql`

**Interfaces:**
- Consumes: `has_permission` (Task 2). Produces: every RPC/policy re-gated; `has_org_role` becomes a shim over `role_id`.

- [ ] **Step 1: Collect current definitions.** For each function below, copy its LATEST definition (grep migrations, take the last occurrence) into the new migration and change ONLY the guard expression. Do not re-derive function bodies from memory.

Replacement map (exact — the only allowed edit per function):

| Function | Old guard | New guard |
|---|---|---|
| place_order | has_org_role(org, {owner,org_admin,seller}) | has_permission(org,'orders','add') |
| confirm_order, close_order, cancel_order, set_run_status | same array | has_permission(org,'orders','edit') *(set_run_status: 'dispatch','edit')* |
| reopen_order | {owner,org_admin} | has_permission(org,'orders.reopen','use') |
| complete_order_task, claim_weigh_task | {…,inventory,logistics} | has_permission(org,'warehouse_tasks','edit') |
| dispatch_assign_order, dispatch_unassign_order, dispatch_depart_truck, dispatch_reorder_run, dispatch_assign_driver | {…,logistics} | has_permission(org,'dispatch','edit') |
| dispatch_set_loaded, dispatch_claim_loading | {…,logistics} | has_permission(org,'loading','edit') OR has_permission(org,'dispatch','edit') |
| can_record_stop | {…} OR assigned driver | has_permission(org,'driver_deck','edit') OR assigned driver (keep OR branch verbatim) |
| admin_clear_org_data | {owner} | has_permission(org,'data_console.manage','use') — **note: today this is owner; data_console.manage is seeded to org_admin. Today's owner-only check contradicts the console being admin-only; align it to the console gate and flag in PR description.** |
| get_dashboard_today / _sales / _insights | {owner,org_admin,seller} | has_permission(org,'dashboard','view') OR has_permission(org,'orders','view') *(sellers call these? verify each call site; if only the dashboard page calls them, plain ('dashboard','view') — check first, choose accordingly, and record the choice in the migration comment)* |
| approve/reject_leave_request, approve/reject_leave_credit, close_leave_year | {owner,org_admin,hr} | has_permission(org,'leave_management','edit') |
| leave_available | approver OR self | has_permission(org,'leave_management','view') OR self |

RLS policy rewrites (drop + recreate each, body otherwise verbatim):

| Table.policy | New using/check |
|---|---|
| organizations update/delete owner | has_permission(id,'organization.manage','use') |
| organization_members insert/update admin | has_permission(organization_id,'membership.role.change','use') |
| member_scopes admin write | has_permission(organization_id,'membership.scope.change','use') *(drops legacy farm_manager)* |
| invitations select-admin/insert/revoke | has_permission(organization_id,'membership.invite','use') (keep invitee OR-branch) |
| access_reviews + access_review_items | has_permission(org,'access_review.run','use') (keep subject OR-branch) |
| leave_types / public_holidays / leave_ledger approver write | has_permission(organization_id,'leave_management','edit') |
| leave_requests / leave_credit_requests approver read | has_permission(organization_id,'leave_management','view') |

Finally redefine `has_org_role` as a deprecated shim (keeps any straggler working until Task 13):

```sql
create or replace function has_org_role(target_org uuid, roles text[])
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from organization_members m
    join organization_roles r on r.id = m.role_id
    where m.organization_id = target_org and m.user_id = auth.uid()
      and m.status = 'active' and (m.expires_at is null or m.expires_at > now())
      and r.key = any(roles)
  );
$$;
```

- [ ] **Step 2: Apply + smoke.** `npx supabase db reset`; then with seeded accounts (Seed demo data), psql-impersonation or app smoke: seller can place order, worker cannot; driver blocked from dispatch RPCs. Minimum: reset applies cleanly + `select has_permission(...)` spot-checks for 3 role/resource pairs using each seeded member's role.
- [ ] **Step 3: Commit** — `git commit -m "feat(rbac): rewrite RPCs and RLS policies to has_permission"`

---

### Task 5: Page guard sweep

**Files (modify):** the 13 pages listed below + `src/features/orders/server/guards.ts` (add nothing; guards live in Task 3's module).

Replace `requireOrgRole(slug, SOME_ROLES)` / `requireRoleOrRedirect(...)` with `requirePermission(slug, resource, 'view')` / `requirePermissionOrRedirect(...)`:

| Page | New check |
|---|---|
| customers/page.tsx:17 | ('customers','view') |
| products/page.tsx:20 | ('products','view') |
| loading/page.tsx:20 | ('loading','view') |
| dashboard/page.tsx:24 | ('dashboard','view') |
| delivery/page.tsx:18 | ('delivery_setup','view') |
| market-prices/page.tsx:23 | ('market_prices','view') |
| tasks/page.tsx:20 | ('warehouse_tasks','view') |
| orders/page.tsx:19, orders/[orderId]/page.tsx:18, orders/new/page.tsx:17 | ('orders','view') (`new` page: ('orders','add')) |
| data-console/page.tsx:12 | ('data_console.manage','use') |
| dispatch/page.tsx:18 | ('dispatch','view') |
| runs/page.tsx:18 | ('delivery_runs','view') |

Also: `leave/page.tsx:20` keeps `requireMember`; `leave/manage/page.tsx:20` → ('leave_management','view'); drive layout (`src/app/[locale]/drive/[organizationSlug]/layout.tsx:39`) → ('driver_deck','view'); `settings/roles/page.tsx` → ('roles','view') (full page refactor in Task 11 — here just note it).

Pages that pass `callerRole` to clients keep working: `PermissionContext.roleKey` substitutes; where the client only needs booleans, prefer passing grants (Task 9 finishes this).

- [ ] **Step 1:** Rewrite each page listed. **Step 2:** `npx tsc --noEmit` → PASS. **Step 3:** Manual spot check via dev server: log in as seller@gmail.com / password123, open products (ok) and tasks (404). **Step 4: Commit** — `git commit -m "feat(rbac): page guards check permissions instead of role arrays"`

---

### Task 6: Server-action wrapper sweep

**Files (modify):**
- `src/features/orders/server/order-actions.ts` (`guardRoles` at :66 + ~20 call sites)
- `src/features/orders/server/schedule-actions.ts:42`, `driver-actions.ts:48`
- `src/features/logistics/server/facility-actions.ts` (`guardRoles` :33 + 8 sites), `dispatch-actions.ts` (`guardDispatch` :41 + 8 sites)
- `src/features/hr/server/guards.ts` (`requireLeaveApprover`, `requireMember`), `manage-actions.ts:45`, `leave-actions.ts:60`
- `src/features/dashboard/server/analytics-actions.ts:19`, `src/features/data-console/server/actions.ts:21`
- Delete once unreferenced: `src/features/orders/lib/roles.ts`, `src/features/logistics/lib/roles.ts`, role arrays in `src/features/hr/lib/roles.ts`
- Tests: existing `*.test.ts` beside these actions — update mocks from role arrays to permission checks.

Rewrite each wrapper to take `(resource, action)` and delegate to `requirePermission`. Mapping rule (apply mechanically):
- create/place actions → `add`; status moves, updates, claims, assignment → `edit`; destructive removals → `delete`; read-only queries → `view`.
- Orders: MANAGER_ROLES sites → ('orders', add|edit per verb); STAFF_ROLES sites (task complete/weigh claims at :377,:465,:498) → ('warehouse_tasks','edit'); the `["owner","org_admin"]` literal at :875 (reopen) → ('orders.reopen','use').
- Facility actions: MANAGER sites → ('delivery_runs','edit') or ('delivery_setup','edit') by what they mutate (facility/SSM records = delivery_setup); FACILITY_ADMIN at :102 → ('delivery_setup','edit').
- Dispatch: DISPATCH sites → ('dispatch','edit'); LOADING sites (:129,:451,:479) → ('loading','edit') **or** ('dispatch','edit') — implement as a two-key check helper `requireAnyPermission(slug, pairs)` in `require-permission.ts` if needed (add a test for it there).
- HR: `requireLeaveApprover` → ('leave_management', 'view' for reads, 'edit' for mutations); `requireMember` unchanged.
- Analytics → ('dashboard','view') matching Task 4's choice. Data console actions → ('data_console.manage','use').

- [ ] **Step 1:** Rewrite wrappers + call sites. **Step 2:** Update the affected `*.test.ts` mocks; `npx vitest run src/features/orders src/features/logistics src/features/hr` → PASS. **Step 3:** `npx tsc --noEmit` → PASS (role-constant files now deletable; delete them). **Step 4: Commit** — `git commit -m "feat(rbac): server actions check permissions; retire role-array constants"`

---

### Task 7: identity-access re-point (capabilities, grant-rank, pickers)

**Files (modify):**
- `src/features/identity-access/server/actions.ts` — every `can(actor, '<capability>')` call (lines ~241, 321, 324, 433, 495, 633, 636, 669, 744, 838, 915, 922, 1014, 1083, 1178, 1181, 1277, 1370, 1440, 1621) → `await` a new helper `actorCan(orgId, actorRoleId, '<capability>')` reading `role_permissions` (add it to `require-permission.ts`: `actorCan(roleId: string, capability: string): Promise<boolean>` — one indexed lookup).
- `src/lib/auth/permissions.ts` — `canGrantRole`/`highestGrantableRole`/`getRoleRank` reworked to rank numbers from `organization_roles` rows: new signatures `canGrantRole(actorRank: number, targetRank: number, actorCanChangeRoles: boolean): boolean` (pure; `targetRank <= actorRank && actorCanChangeRoles`). Old matrix/`can` stay exported until Task 13 (parity test still imports them).
- `src/components/forms/invite-user-dialog.tsx`, `create-user-dialog.tsx`, `src/features/identity-access/components/users-page-client.tsx`, `user-detail-client.tsx` — role pickers render `organization_roles` rows (id + name), passed down from the server page (fetch in the page component; filter `rank <= actorRank`), instead of the hardcoded `ROLES` array. Invite/create/role-change actions accept `roleId` (validate it belongs to the org and rank rule server-side).
- `step_up.reauth`: grep usages; the reauth gate keys off AAL2/authentication, so remove the capability check wherever it appears (keep the AAL2 requirement itself).
- `src/features/identity-access/schema.ts` (:79, :105, :152): `z.enum(ROLES)` → `z.string().uuid()` for roleId fields.

- [ ] **Step 1:** Implement; adjust `landing.ts` only if it type-errors (full rewrite in Task 8). **Step 2:** `npx vitest run src/features/identity-access` + `npx tsc --noEmit` → PASS. **Step 3:** Dev-server check: invite dialog lists roles from DB incl. any custom role. **Step 4: Commit** — `git commit -m "feat(rbac): identity-access capability checks + role pickers read organization_roles"`

---

### Task 8: Nav model, layouts, landing

**Files:**
- Modify: `src/features/dashboard/components/dashboard-shell-model.ts`, `app-sidebar.tsx`, both layouts (`(seller)`/`(dashboard)` `[organizationSlug]/layout.tsx`), `src/features/identity-access/server/landing.ts`
- Test: `src/features/dashboard/components/dashboard-shell-model.test.ts` (create if absent)

**Interfaces:**
- `getDashboardSidebarGroups({ organizationSlug, pathname, grants }: { grants: ReadonlySet<PermissionKey> })` — role param replaced by grants set.
- Layouts call `resolvePermissionsForOrg(slug)` and pass `grants` (serialized as `PermissionKey[]`, rebuilt as Set client-side) to `AppSidebar`.

- [ ] **Step 1: Failing test** — seller-grants set shows Sales+Fulfillment+My Leave, hides dashboard/settings/loading; inventory-grants set shows Warehouse group; org_admin set includes Data console; custom "viewer" set (`products:view` only) shows just Products.

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_GRANTS } from "@/lib/auth/rbac";
import { getDashboardSidebarGroups } from "./dashboard-shell-model";

const groupsFor = (grants: ReadonlySet<string>) =>
  getDashboardSidebarGroups({ organizationSlug: "acme", pathname: "/acme/products", grants });

const flat = (gs: ReturnType<typeof groupsFor>) => gs.flatMap((g) => g.items.map((i) => i.titleKey));

describe("permission-driven nav", () => {
  it("seller sees sales pages, no dashboard/settings", () => {
    const keys = flat(groupsFor(DEFAULT_ROLE_GRANTS.seller));
    expect(keys).toContain("pages.products");
    expect(keys).not.toContain("pages.dashboard");
    expect(keys).not.toContain("pages.loading");
  });
  it("worker sees warehouse only", () => {
    const keys = flat(groupsFor(DEFAULT_ROLE_GRANTS.inventory));
    expect(keys).toEqual(expect.arrayContaining(["pages.warehouseTasks", "pages.loading", "pages.myLeave"]));
    expect(keys).not.toContain("pages.orders");
  });
  it("admin sees data console, owner does not", () => {
    expect(flat(groupsFor(DEFAULT_ROLE_GRANTS.org_admin))).toContain("pages.dataConsole");
    expect(flat(groupsFor(DEFAULT_ROLE_GRANTS.owner))).not.toContain("pages.dataConsole");
  });
  it("view-only custom role sees just its page", () => {
    expect(flat(groupsFor(new Set(["products:view"])))).toEqual(["pages.products"]);
  });
});
```

- [ ] **Step 2: Run — FAIL.** **Step 3: Implement:** each nav item in `routeGroups` gains `resource` (+ `requiredAction?: "use"` for data console → resource `data_console.manage`); one generic filter replaces all four role-branch blocks; empty groups dropped. `settings/*` items map: organization/users→`settings`/`users`, roles→`roles`, access-reviews→`access_review.run:use`, audit-log→`audit_log.read:use`. `getDashboardPageContext` builds from the full unfiltered group list (drop the fake `role:"org_admin"`). Landing: first item of the member's filtered groups; driver special-case (`driver_deck:view` and no other view grants → `/drive/{slug}`); fallback `/settings/organization` → keep as final else. **Step 4: Run — PASS**; `npx tsc --noEmit`. **Step 5: Commit** — `git commit -m "feat(rbac): permission-driven nav, layouts, landing"`

---

### Task 9: Client-side gates

**Files (modify):**
- `src/app/[locale]/(seller)/[organizationSlug]/delivery/delivery-client.tsx:75` — `canEdit` prop computed server-side (`grants.has("delivery_setup:edit")`) and passed in; delete the role comparison.
- `src/app/[locale]/(seller)/[organizationSlug]/orders/[orderId]/page.tsx` + `order-detail-client.tsx:744` — pass `canReopen = grants.has("orders.reopen:use")`.
- `src/features/orders/lib/board-rules.ts:17` — `REOPEN_ROLES`/role param → `canReopen: boolean` param; update `board-view-model.ts:50-52` and `orders-board.tsx:162,196,287` accordingly; orders page passes the boolean.
- Tests: any board-rules tests updated to the boolean param.

- [ ] **Step 1:** Implement. **Step 2:** `npx vitest run src/features/orders && npx tsc --noEmit` → PASS. **Step 3:** Dev check: seller sees no Reopen on a closed order; owner does. **Step 4: Commit** — `git commit -m "feat(rbac): client gates driven by server-resolved grants"`

---

### Task 10: Roles editor — server actions

**Files:**
- Modify: `src/features/identity-access/server/roles.ts` (replace the MOD-19 stub: `getRolesView`, `updateRoleCapabilityAction`, `resetRoleToDefaultsAction`)
- Test: `src/features/identity-access/server/roles.test.ts`

**Interfaces (produced; consumed by Task 11):**
```ts
type RoleRow = { id: string; key: string; name: string; description: string | null;
  rank: number; isSystem: boolean; memberCount: number };
type RolesView = { roles: RoleRow[]; grants: Record<string /*roleId*/, PermissionKey[]>;
  canEdit: boolean; actorRank: number };
getRolesView(organizationSlug: string): Promise<RolesView>
createRoleAction(input: { organizationSlug: string; name: string; cloneFromRoleId?: string }): Promise<ActionResult>
renameRoleAction(input: { organizationSlug: string; roleId: string; name: string; description?: string }): Promise<ActionResult>
deleteRoleAction(input: { organizationSlug: string; roleId: string }): Promise<ActionResult>
setPermissionAction(input: { organizationSlug: string; roleId: string; resource: string;
  action: PermissionAction; granted: boolean }): Promise<ActionResult>
resetRoleToDefaultsAction(input: { organizationSlug: string; roleId: string }): Promise<ActionResult>
```
(`ActionResult` — reuse the repo's existing action result shape from `identity-access/server/actions.ts`; read it first.)

Rules enforced in every mutation (RLS backs them up): caller passes `requirePermission(slug,'roles','edit')`; owner role → reject all grant edits; system role → reject rename/delete; delete → reject while `memberCount > 0`; `setPermissionAction` revoking `view` also revokes `add/edit/delete` for that resource; granting `add/edit/delete` auto-grants `view`; created role rank = min(actorRank − 1, 10) floor 1; key = slugified name, uniqueness enforced, reject collision with a clear error.

- [ ] **Step 1: Failing tests** — non-editor rejected; owner-grant edit rejected; system rename rejected; delete-with-members rejected; view-revoke cascades; create-with-clone copies grants. Mock Supabase per the existing pattern in `roles.test.ts`/neighboring tests. **Step 2: Run — FAIL.** **Step 3: Implement.** **Step 4: Run — PASS.** **Step 5: Commit** — `git commit -m "feat(rbac): roles editor server actions"`

---

### Task 11: Roles editor — UI

**Files:**
- Modify: `src/app/[locale]/(dashboard)/[organizationSlug]/settings/roles/page.tsx`
- Create: `src/features/identity-access/components/roles-editor.tsx` (client), `role-permissions-grid.tsx` (client)
- Delete after rewiring: old read-only pieces no longer rendered (`capability-matrix.tsx`, `rank-ladder.tsx` — keep `roles-masthead.tsx`, `invitations-queue.tsx`, `role-roster.tsx` if the layout keeps them; decide by fit, don't extend them)
- Modify: `src/messages/en.json`, `src/messages/ms.json` (+ typegen file per repo pattern) — namespace `identity.rolesEditor.*`
- Also delete: `src/features/identity-access/components/roles-page-client.tsx` (superseded stub)

Layout: keep the masthead style. Below it: left rail = role list (system roles badged + ranked, custom below, member counts, **New role** button → dialog with name + clone-from select). Main panel for selected role: header (inline rename for custom, delete with disabled-reason tooltip), **Pages** section — table: resource rows × view/add/edit/delete switches (shadcn `Switch` or the repo's existing toggle component — match whatever `settings/*` pages already use), **Administration** section — capability toggles grouped (Organization / Membership / Access Review / Break-glass / Audit & Auth — reuse the grouping in `src/features/access-control/lib/group-capabilities.ts`, extended with `orders.reopen` under Sales-ish group and `data_console.manage` under Organization). Owner selected → everything disabled with a lock note. Optimistic toggle with server action + `router.refresh()` on settle; failures toast + revert (match the repo's existing mutation UX — read one settings client component first).

- [ ] **Step 1:** Page: `requirePermission(slug,'roles','view')`, load `getRolesView`, render editor. **Step 2:** Components per above. **Step 3:** i18n keys (EN + BM). **Step 4:** `npx tsc --noEmit` → PASS. **Step 5:** Dev verification (preview tools): as admin@gmail.com — create role "Viewer", grant products view only; toggle persists across reload; owner row locked; seller row editable. **Step 6: Commit** — `git commit -m "feat(rbac): editable roles & permissions page"`

---

### Task 12: End-to-end verification sweep

**Files:** none new (fixes as found).

- [ ] **Step 1:** `npx vitest run` — full suite green.
- [ ] **Step 2:** `npx tsc --noEmit` and the repo's lint/build gates (check `package.json`).
- [ ] **Step 3:** Seed demo data, then walk each seeded account (all `password123`):
  - admin@gmail.com: everything incl. data console + roles editor.
  - owner@gmail.com: everything except data console; roles editor works; owner row locked.
  - seller@gmail.com / supervisor@gmail.com: products/orders/customers/market prices/dispatch/runs/delivery(read-only setup)/My Leave; no dashboard, no settings, no loading page; landing = products.
  - worker@gmail.com: tasks/loading/My Leave only.
  - hr@gmail.com: My Leave + Leave Management; landing = leave/manage.
  - driver1@gmail.com: driver deck.
- [ ] **Step 4:** Custom-role e2e: as admin, create "Viewer" (products view only), change worker@gmail.com to Viewer via users page, re-login as worker → nav shows Products only; product create/edit controls absent; direct POST (server action) rejected. Change back afterwards.
- [ ] **Step 5:** Revoke `products:delete` from seller; verify delete affordance disappears AND the delete server action rejects for seller. Reset to defaults; verify restore.
- [ ] **Step 6:** Run the e2e suite if configured (check for playwright config; `repo-gotchas` notes e2e label coupling — read that memory file first).
- [ ] **Step 7: Commit fixes** — `git commit -m "test(rbac): full-role verification sweep fixes"`

---

### Task 13: Cleanup migration + dead code (GATED)

**Do NOT execute in the same deploy.** Only after Tasks 1–12 are deployed and verified in prod (prod migration debt is tracked separately — see `prod-deploy-debt` memory).

**Files:**
- Create: `supabase/migrations/<next>_dynamic_rbac_cleanup.sql` — drop `organization_members.role` + `invitations.role` text columns, sync triggers, `has_org_role`, `role_capability_overrides` (+ its RLS), `effective_capabilities` helper.
- Delete: legacy exports in `src/lib/auth/permissions.ts` (matrix, `can`, `CAPABILITIES`, `ROLES` — after re-pointing the parity test to a frozen snapshot or deleting it), `src/lib/auth/permissions.server.ts`, remaining `access-control` lib files unused after Task 11.

- [ ] Steps: write migration → grep app for any remaining reader of the dropped columns/functions (`rg "\.role\b" src/ --type ts` and review) → apply locally → full suite + tsc → commit `chore(rbac): drop legacy role columns and helpers`.

---

## Self-review notes (done)

- Spec coverage: schema (T2), has_permission + RPC/RLS (T2/T4), guard + resolver (T3), page sweep (T5), action sweep (T6), identity-access + pickers + rank (T7), nav/landing (T8), client gates (T9), editor actions/UI (T10/T11), tests/e2e (T1/T12), cleanup (T13). Deviations from spec called out inline: no owner short-circuit in `has_permission` (owner ≠ data console today); `admin_clear_org_data` aligned to `data_console.manage`; `step_up.reauth` retired rather than carried (it was structural, not a grant).
- Type consistency: `PermissionKey`/`grantKey` defined once (T1) and consumed by T3/T8/T10/T11; guard context named `PermissionContext` throughout; wrapper helper `requireAnyPermission` introduced in T6 lives in T3's module.
- Known judgment points left to executors are bounded and explicit (dashboard RPC audience in T4; which aside components survive in T11) — each says how to decide and where to record it.
