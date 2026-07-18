-- 20260712000001_role_capability_overrides.sql
-- MOD-19 / Roles & Permissions: persist per-organization edits to the
-- role/capability matrix.
--
-- Storage model:
--   * The canonical matrix is still hard-coded in src/lib/auth/permissions.ts
--     so that the rest of the app does not pay for a DB lookup on every can()
--     call.
--   * This table stores *overrides* on top of the canonical matrix, scoped
--     per organization. Rows are only created when an owner flips a single
--     toggle for that role; absence of a row means "use the built-in default".
--   * RLS: only `owner` of the organization can read/write these rows.
--   * Owner-locked capabilities: anything that would let an owner lock
--     themselves out is structurally non-overridable (enforced both here
--     via CHECK and in the `effective_capabilities` helper).
--
-- Each row encodes: for this {organization, role}, the explicit decision for
-- this {capability}. `granted = true` means enable beyond the default;
-- `granted = false` means revoke beyond the default. Owners see the
-- post-override matrix; non-owners always see the default matrix.
--
-- This is an additive migration. Existing hardcoded behavior is unchanged
-- when the table has zero rows.

begin;

-- ---------------------------------------------------------------------------
-- role_capability_overrides
-- ---------------------------------------------------------------------------
create table if not exists public.role_capability_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role text not null check (role in (
    'owner','org_admin','farm_manager','supervisor','caretaker',
    'veterinarian','biosecurity_qa','maintenance','inventory',
    'logistics','auditor','support'
  )),
  capability text not null check (char_length(capability) between 3 and 120),
  granted boolean not null,
  reason text null check (char_length(reason) <= 1000),
  changed_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One row per (org, role, capability); multiple toggles append history
  -- indirectly via audit_log, not via row churn.
  unique (organization_id, role, capability),
  -- Owner is structurally non-overridable: any row attempting to override an
  -- owner's capability set must be rejected. Owner always has every capability
  -- by definition, so there is nothing meaningful to store.
  check (role <> 'owner')
);

create index if not exists role_capability_overrides_org_role_idx
  on public.role_capability_overrides(organization_id, role);

comment on table public.role_capability_overrides is
  'Per-organization overrides on top of the canonical role/capability matrix. Read by the `effective_capabilities` helper to resolve `can()` queries at runtime.';

-- Stamp updated_at on UPDATE so audit consumers can see the last edit time.
create or replace function public.role_capability_overrides_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists role_capability_overrides_touch on public.role_capability_overrides;
create trigger role_capability_overrides_touch
  before update on public.role_capability_overrides
  for each row execute function public.role_capability_overrides_set_updated_at();

commit;
