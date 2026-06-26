-- 20260626000001_mod03_flock_lifecycle_core.sql
-- MOD-03 core schema: flock lifecycle, readiness, placement, movement,
-- count transactions, harvest planning and closeout.

begin;

create table if not exists public.flocks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete restrict,
  house_id uuid null references public.houses(id) on delete restrict,
  production_profile_id uuid not null references public.production_profiles(id) on delete restrict,
  target_profile_version_id uuid null references public.target_profile_versions(id) on delete restrict,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
  name text not null check (char_length(name) between 2 and 150),
  production_type text not null check (production_type in ('layer','broiler','breeder','smallholder')),
  source_name text not null check (char_length(source_name) between 2 and 150),
  breed_strain text not null check (char_length(breed_strain) between 1 and 120),
  sex text not null default 'unknown' check (sex in ('mixed','female','male','unknown')),
  hatch_date date not null,
  planned_arrival_date date not null,
  expected_end_date date null,
  planned_quantity integer not null check (planned_quantity > 0),
  current_live_birds integer not null default 0 check (current_live_birds >= 0),
  status text not null default 'draft' check (status in (
    'draft','planned','readiness_pending','ready','active','restricted',
    'harvest_pending','depopulated','closing','closed'
  )),
  restriction_reason text null check (restriction_reason is null or char_length(restriction_reason) <= 500),
  closed_at timestamptz null,
  closed_by uuid null references auth.users(id),
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id),
  version integer not null default 1,
  client_operation_id uuid null,
  unique (organization_id, code),
  check (planned_arrival_date >= hatch_date),
  check (expected_end_date is null or expected_end_date >= planned_arrival_date),
  check ((status = 'closed') = (closed_at is not null))
);

create index if not exists flocks_org_status_idx
  on public.flocks(organization_id, status);

create index if not exists flocks_org_site_house_idx
  on public.flocks(organization_id, site_id, house_id, status);

create unique index if not exists flocks_house_open_idx
  on public.flocks(house_id)
  where house_id is not null
    and status in ('planned','readiness_pending','ready','active','restricted','harvest_pending');

create unique index if not exists flocks_client_op_idx
  on public.flocks(organization_id, client_operation_id)
  where client_operation_id is not null;

create table if not exists public.flock_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete restrict,
  house_id uuid null references public.houses(id) on delete restrict,
  flock_id uuid not null unique references public.flocks(id) on delete cascade,
  plan_notes text null check (plan_notes is null or char_length(plan_notes) <= 1000),
  supply_plan jsonb not null default '{}'::jsonb,
  health_plan jsonb not null default '{}'::jsonb,
  required_documents jsonb not null default '[]'::jsonb,
  approval_status text not null default 'draft' check (approval_status in ('draft','approved','rejected')),
  approved_by uuid null references auth.users(id),
  approved_at timestamptz null,
  approval_notes text null check (approval_notes is null or char_length(approval_notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id),
  check ((approval_status = 'approved') = (approved_by is not null and approved_at is not null))
);

create table if not exists public.house_readiness_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete restrict,
  house_id uuid not null references public.houses(id) on delete restrict,
  flock_id uuid not null references public.flocks(id) on delete cascade,
  checklist_version text not null check (char_length(checklist_version) between 1 and 40),
  results jsonb not null default '[]'::jsonb,
  exceptions jsonb not null default '[]'::jsonb,
  approval_status text not null default 'approved' check (approval_status in ('approved','rejected')),
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  approver_notes text not null check (char_length(approver_notes) between 5 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists readiness_flock_idx
  on public.house_readiness_reviews(flock_id, approved_at desc);

create table if not exists public.placements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete restrict,
  house_id uuid not null references public.houses(id) on delete restrict,
  flock_id uuid not null references public.flocks(id) on delete cascade,
  placement_time timestamptz not null,
  actual_quantity integer not null check (actual_quantity > 0),
  doa_quantity integer not null default 0 check (doa_quantity >= 0),
  vehicle_reference text null check (vehicle_reference is null or char_length(vehicle_reference) <= 120),
  supplier_reference text null check (supplier_reference is null or char_length(supplier_reference) <= 120),
  initial_observations text null check (initial_observations is null or char_length(initial_observations) <= 1000),
  accepted_by uuid not null references auth.users(id),
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (doa_quantity <= actual_quantity)
);

create unique index if not exists placements_flock_once_idx
  on public.placements(flock_id);

create table if not exists public.flock_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete restrict,
  source_house_id uuid null references public.houses(id) on delete restrict,
  destination_house_id uuid null references public.houses(id) on delete restrict,
  source_flock_id uuid not null references public.flocks(id) on delete restrict,
  destination_flock_id uuid null references public.flocks(id) on delete restrict,
  movement_type text not null check (movement_type in ('transfer_in','transfer_out','split','merge','partial_removal')),
  quantity integer not null check (quantity > 0),
  reason text not null check (char_length(reason) between 5 and 500),
  approval_status text not null default 'approved' check (approval_status in ('pending','approved','rejected')),
  approved_by uuid null references auth.users(id),
  approved_at timestamptz null,
  lineage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id)
);

create index if not exists flock_movements_source_idx
  on public.flock_movements(source_flock_id, created_at desc);

create table if not exists public.flock_count_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete restrict,
  house_id uuid null references public.houses(id) on delete restrict,
  flock_id uuid not null references public.flocks(id) on delete cascade,
  transaction_type text not null check (transaction_type in (
    'placement','mortality','cull','transfer_in','transfer_out','harvest','depopulation','adjustment'
  )),
  quantity integer not null,
  occurred_at timestamptz not null default now(),
  source_table text null check (source_table is null or char_length(source_table) <= 80),
  source_id uuid null,
  reason text null check (reason is null or char_length(reason) <= 500),
  evidence jsonb not null default '{}'::jsonb,
  approval_status text not null default 'approved' check (approval_status in ('pending','approved','rejected')),
  approved_by uuid null references auth.users(id),
  approved_at timestamptz null,
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id),
  check (transaction_type = 'adjustment' or quantity > 0),
  check (transaction_type <> 'adjustment' or quantity <> 0),
  check (approval_status <> 'approved' or approved_at is not null)
);

create index if not exists flock_count_transactions_flock_idx
  on public.flock_count_transactions(flock_id, occurred_at);

create table if not exists public.flock_stage_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete restrict,
  house_id uuid null references public.houses(id) on delete restrict,
  flock_id uuid not null references public.flocks(id) on delete cascade,
  stage text not null check (char_length(stage) between 1 and 100),
  age_day integer not null check (age_day >= 0),
  effective_from timestamptz not null,
  effective_to timestamptz null,
  target_profile_version_id uuid null references public.target_profile_versions(id) on delete restrict,
  override_reason text null check (override_reason is null or char_length(override_reason) <= 500),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);

create index if not exists flock_stage_history_flock_idx
  on public.flock_stage_history(flock_id, effective_from desc);

create table if not exists public.harvest_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete restrict,
  house_id uuid null references public.houses(id) on delete restrict,
  flock_id uuid not null references public.flocks(id) on delete cascade,
  planned_date date not null,
  destination text not null check (char_length(destination) between 2 and 150),
  expected_quantity integer not null check (expected_quantity > 0),
  expected_weight_kg numeric(12,3) null check (expected_weight_kg is null or expected_weight_kg > 0),
  crew_notes text null check (crew_notes is null or char_length(crew_notes) <= 1000),
  vehicle_reference text null check (vehicle_reference is null or char_length(vehicle_reference) <= 120),
  readiness jsonb not null default '{}'::jsonb,
  approval_status text not null default 'planned' check (approval_status in ('planned','approved','completed','cancelled')),
  approved_by uuid null references auth.users(id),
  approved_at timestamptz null,
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id)
);

create index if not exists harvest_plans_flock_idx
  on public.harvest_plans(flock_id, planned_date desc);

create table if not exists public.flock_closeouts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete restrict,
  house_id uuid null references public.houses(id) on delete restrict,
  flock_id uuid not null unique references public.flocks(id) on delete cascade,
  final_live_birds integer not null check (final_live_birds >= 0),
  reconciliation jsonb not null default '{}'::jsonb,
  final_kpis jsonb not null default '{}'::jsonb,
  open_exceptions jsonb not null default '[]'::jsonb,
  approval_notes text not null check (char_length(approval_notes) between 10 and 1000),
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  locked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

commit;
