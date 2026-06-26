-- 20260626000006_mod04_daily_operations_core.sql
-- MOD-04 core schema: daily shifts, guided inspections, observations,
-- handovers, period closes, corrections and offline sync operations.

begin;

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete restrict,
  name text not null check (char_length(name) between 2 and 120),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  role_requirements jsonb not null default '{}'::jsonb,
  status text not null default 'planned' check (status in ('planned','active','completed','cancelled')),
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id),
  version integer not null default 1,
  check (ends_at > starts_at)
);

create index if not exists shifts_org_site_time_idx
  on public.shifts(organization_id, site_id, starts_at, ends_at);

create table if not exists public.shift_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  site_id uuid not null references public.sites(id) on delete restrict,
  house_id uuid null references public.houses(id) on delete restrict,
  responsibility text not null check (char_length(responsibility) between 2 and 120),
  status text not null default 'assigned' check (status in ('assigned','acknowledged','completed','cancelled')),
  acknowledged_at timestamptz null,
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id)
);

create unique index if not exists shift_assignments_unique_scope_idx
  on public.shift_assignments(shift_id, user_id, coalesce(house_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index if not exists shift_assignments_user_idx
  on public.shift_assignments(organization_id, user_id, status);

create table if not exists public.inspection_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 150),
  description text null check (description is null or char_length(description) <= 500),
  status text not null default 'draft' check (status in ('draft','active','retired')),
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id),
  version integer not null default 1,
  unique (organization_id, name)
);

create table if not exists public.inspection_template_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_id uuid not null references public.inspection_templates(id) on delete cascade,
  version text not null check (char_length(version) between 1 and 40),
  production_types text[] not null default array['*']::text[],
  risk_classes text[] not null default array['*']::text[],
  applicability jsonb not null default '{}'::jsonb,
  definition jsonb not null default '{"sections":[]}'::jsonb,
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','retired')),
  effective_from timestamptz null,
  effective_to timestamptz null,
  approved_by uuid null references auth.users(id),
  approved_at timestamptz null,
  approval_notes text null check (approval_notes is null or char_length(approval_notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id),
  row_version integer not null default 1,
  unique (template_id, version),
  check (effective_to is null or effective_from is null or effective_to > effective_from),
  check (status <> 'approved' or (approved_by is not null and approved_at is not null))
);

create index if not exists inspection_template_versions_match_idx
  on public.inspection_template_versions(organization_id, status);

create table if not exists public.inspections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete restrict,
  house_id uuid not null references public.houses(id) on delete restrict,
  flock_id uuid null references public.flocks(id) on delete restrict,
  shift_id uuid null references public.shifts(id) on delete set null,
  template_version_id uuid not null references public.inspection_template_versions(id) on delete restrict,
  status text not null default 'in_progress' check (status in ('draft','in_progress','submitted','reviewed','locked','void')),
  event_time timestamptz not null default now(),
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  started_by uuid null references auth.users(id),
  completed_by uuid null references auth.users(id),
  device_time timestamptz null,
  entry_time timestamptz not null default now(),
  sync_time timestamptz null,
  signature text null check (signature is null or char_length(signature) between 2 and 150),
  quality_score integer null check (quality_score between 0 and 100),
  sync_status text not null default 'server' check (sync_status in ('server','synced','unsynced','conflicted','rejected')),
  client_operation_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id),
  version integer not null default 1,
  check (completed_at is null or completed_at >= started_at)
);

create unique index if not exists inspections_client_op_idx
  on public.inspections(organization_id, client_operation_id)
  where client_operation_id is not null;

create index if not exists inspections_org_house_time_idx
  on public.inspections(organization_id, house_id, started_at desc);

create table if not exists public.inspection_responses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  question_key text not null check (char_length(question_key) between 1 and 120),
  label text null check (label is null or char_length(label) <= 200),
  response_type text not null check (response_type in ('boolean','number','text','select')),
  value jsonb not null,
  unit text null check (unit is null or char_length(unit) <= 40),
  status text not null default 'ok' check (status in ('ok','abnormal','skipped','corrected')),
  exception_reason text null check (exception_reason is null or char_length(exception_reason) <= 500),
  source text not null default 'manual' check (source in ('manual','device','calculated')),
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id),
  version integer not null default 1,
  unique (inspection_id, question_key)
);

create table if not exists public.observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  inspection_id uuid null references public.inspections(id) on delete set null,
  site_id uuid not null references public.sites(id) on delete restrict,
  house_id uuid not null references public.houses(id) on delete restrict,
  flock_id uuid null references public.flocks(id) on delete restrict,
  category text not null check (category in ('health','environment','feed_water','litter','equipment','production','biosecurity','other')),
  severity text not null default 'low' check (severity in ('info','low','medium','high','critical')),
  description text not null check (char_length(description) between 1 and 1000),
  immediate_action text null check (immediate_action is null or char_length(immediate_action) <= 1000),
  media jsonb not null default '[]'::jsonb,
  follow_up_type text null check (follow_up_type is null or follow_up_type in ('task','health_case','work_order','biosecurity_incident','alert_acknowledgement')),
  follow_up jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','in_progress','resolved','dismissed')),
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id),
  resolved_at timestamptz null,
  resolved_by uuid null references auth.users(id)
);

create index if not exists observations_org_status_idx
  on public.observations(organization_id, status, severity, created_at desc);

create table if not exists public.handovers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete restrict,
  from_shift_id uuid not null references public.shifts(id) on delete restrict,
  to_shift_id uuid not null references public.shifts(id) on delete restrict,
  unresolved_items jsonb not null default '[]'::jsonb,
  restrictions jsonb not null default '[]'::jsonb,
  equipment_state jsonb not null default '{}'::jsonb,
  next_actions jsonb not null default '[]'::jsonb,
  acknowledgement_notes text null check (acknowledgement_notes is null or char_length(acknowledgement_notes) <= 1000),
  acknowledged_by uuid null references auth.users(id),
  acknowledged_at timestamptz null,
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id)
);

create table if not exists public.period_closes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete restrict,
  house_id uuid null references public.houses(id) on delete restrict,
  period_type text not null check (period_type in ('daily','weekly')),
  operating_date date null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  completeness jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','ready','approved','locked','rejected')),
  reviewer_notes text null check (reviewer_notes is null or char_length(reviewer_notes) <= 1000),
  reviewed_by uuid null references auth.users(id),
  approved_by uuid null references auth.users(id),
  approved_at timestamptz null,
  locked_at timestamptz null,
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id),
  version integer not null default 1,
  check (period_end > period_start),
  check (status not in ('approved','locked') or approved_by is not null)
);

create unique index if not exists period_closes_scope_idx
  on public.period_closes(organization_id, site_id, coalesce(house_id, '00000000-0000-0000-0000-000000000000'::uuid), period_type, period_start, period_end);

create table if not exists public.record_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  target_table text not null check (target_table in ('inspections','inspection_responses','observations','period_closes')),
  target_record_id uuid not null,
  before_value jsonb not null default '{}'::jsonb,
  after_value jsonb not null default '{}'::jsonb,
  reason text not null check (char_length(reason) between 10 and 1000),
  risk_level text not null default 'medium' check (risk_level in ('low','medium','high')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  decided_by uuid null references auth.users(id),
  decided_at timestamptz null,
  reviewer_reason text null check (reviewer_reason is null or char_length(reviewer_reason) <= 1000),
  check (status = 'pending' or (decided_by is not null and decided_at is not null))
);

create table if not exists public.sync_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_operation_id uuid not null,
  entity_id uuid not null,
  entity_type text not null check (entity_type in ('inspection','inspection_response','observation','handover','period_close','correction')),
  mutation_type text not null check (mutation_type in ('create','update','submit','approve','request_correction')),
  local_event_time timestamptz not null,
  local_save_time timestamptz not null,
  base_server_version integer null check (base_server_version is null or base_server_version >= 0),
  payload_schema_version integer not null check (payload_schema_version > 0),
  payload jsonb not null default '{}'::jsonb,
  user_id uuid null references auth.users(id),
  device_id text null check (device_id is null or char_length(device_id) <= 120),
  session_id text null check (session_id is null or char_length(session_id) <= 120),
  attachment_references jsonb not null default '[]'::jsonb,
  upload_state text not null default 'none' check (upload_state in ('none','pending','complete','failed')),
  result text not null default 'accepted' check (result in ('accepted','duplicate','conflict','rejected','retry_later')),
  conflict_detail jsonb not null default '{}'::jsonb,
  processed_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (organization_id, client_operation_id)
);

create index if not exists sync_operations_org_result_idx
  on public.sync_operations(organization_id, result, created_at desc);

commit;
