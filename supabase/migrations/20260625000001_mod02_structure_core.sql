-- 20260625000001_mod02_structure_core.sql
-- MOD-02 core schema: farm structure hierarchy, production profiles,
-- target profile versions, controlled master data and durable labels.

begin;

-- ---------------------------------------------------------------------------
-- sites
-- ---------------------------------------------------------------------------
create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 150),
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
  legal_name text null,
  address text null check (address is null or char_length(address) <= 500),
  latitude numeric(9,6) null check (latitude between -90 and 90),
  longitude numeric(9,6) null check (longitude between -180 and 180),
  time_zone text not null check (time_zone ~ '^[A-Za-z]+/[A-Za-z_]+$|^UTC$'),
  default_unit_system text not null default 'metric' check (default_unit_system in ('metric','imperial')),
  currency_code text not null default 'MYR' check (currency_code ~ '^[A-Z]{3}$'),
  contacts jsonb not null default '[]'::jsonb,
  biosecurity_layout jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','active','inactive','archived')),
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id),
  version integer not null default 1,
  client_operation_id uuid null,
  unique (organization_id, code)
);

create index if not exists sites_org_status_idx
  on public.sites(organization_id, status);

create unique index if not exists sites_client_op_idx
  on public.sites(organization_id, client_operation_id)
  where client_operation_id is not null;

comment on table public.sites is
  'Operational farm/site locations. Site time zone controls operating-day display boundaries.';

-- ---------------------------------------------------------------------------
-- biosecurity_zones
-- ---------------------------------------------------------------------------
create table if not exists public.biosecurity_zones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  parent_zone_id uuid null references public.biosecurity_zones(id) on delete restrict,
  name text not null check (char_length(name) between 2 and 150),
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
  risk_class text not null default 'medium'
    check (risk_class in ('low','medium','high','quarantine')),
  entry_rules jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft','active','maintenance','restricted','inactive','retired')),
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id),
  version integer not null default 1,
  unique (site_id, code),
  check (parent_zone_id is null or parent_zone_id <> id)
);

create index if not exists biosecurity_zones_org_site_idx
  on public.biosecurity_zones(organization_id, site_id, status);

-- ---------------------------------------------------------------------------
-- houses
-- ---------------------------------------------------------------------------
create table if not exists public.houses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  zone_id uuid null references public.biosecurity_zones(id) on delete restrict,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
  name text not null check (char_length(name) between 2 and 150),
  capacity_birds integer not null default 0 check (capacity_birds >= 0),
  length_meters numeric(10,2) null check (length_meters is null or length_meters >= 0),
  width_meters numeric(10,2) null check (width_meters is null or width_meters >= 0),
  height_meters numeric(10,2) null check (height_meters is null or height_meters >= 0),
  housing_system text not null check (housing_system in (
    'closed_house','open_sided','cage','aviary','deep_litter','free_range','other'
  )),
  production_purpose text not null check (production_purpose in (
    'layer','broiler','breeder','smallholder'
  )),
  operational_status text not null default 'draft'
    check (operational_status in ('draft','active','maintenance','restricted','inactive','retired')),
  criticality text not null default 'standard'
    check (criticality in ('standard','important','critical')),
  coordinates jsonb not null default '{}'::jsonb,
  floor_plan jsonb not null default '{}'::jsonb,
  equipment jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id),
  version integer not null default 1,
  client_operation_id uuid null
);

create unique index if not exists houses_site_code_active_idx
  on public.houses(site_id, code)
  where operational_status <> 'retired';

create unique index if not exists houses_client_op_idx
  on public.houses(organization_id, client_operation_id)
  where client_operation_id is not null;

create index if not exists houses_org_site_status_idx
  on public.houses(organization_id, site_id, operational_status);

create index if not exists houses_zone_idx
  on public.houses(zone_id)
  where zone_id is not null;

-- ---------------------------------------------------------------------------
-- house_areas
-- ---------------------------------------------------------------------------
create table if not exists public.house_areas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  house_id uuid not null references public.houses(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
  name text not null check (char_length(name) between 2 and 150),
  area_type text not null default 'section'
    check (area_type in ('room','pen','tier','section','sensor_zone','other')),
  capacity_birds integer null check (capacity_birds is null or capacity_birds >= 0),
  sequence integer not null default 0 check (sequence >= 0),
  geometry jsonb not null default '{}'::jsonb,
  status text not null default 'active'
    check (status in ('draft','active','maintenance','restricted','inactive','retired')),
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id),
  version integer not null default 1,
  unique (house_id, code)
);

create index if not exists house_areas_org_house_idx
  on public.house_areas(organization_id, house_id, status);

-- ---------------------------------------------------------------------------
-- storage_locations
-- ---------------------------------------------------------------------------
create table if not exists public.storage_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  zone_id uuid null references public.biosecurity_zones(id) on delete restrict,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
  name text not null check (char_length(name) between 2 and 150),
  location_type text not null check (location_type in (
    'feed','medicine','chemical','egg','spare_part','general'
  )),
  conditions jsonb not null default '{}'::jsonb,
  restricted boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft','active','maintenance','restricted','inactive','retired')),
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id),
  version integer not null default 1,
  unique (site_id, code)
);

create index if not exists storage_locations_org_site_idx
  on public.storage_locations(organization_id, site_id, status);

-- ---------------------------------------------------------------------------
-- production_profiles
-- ---------------------------------------------------------------------------
create table if not exists public.production_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  type text not null check (type in ('layer','broiler','breeder','smallholder')),
  name text not null check (char_length(name) between 2 and 150),
  workflow_options jsonb not null default '{}'::jsonb,
  owner_user_id uuid null references auth.users(id),
  status text not null default 'draft' check (status in ('draft','active','inactive')),
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id),
  version integer not null default 1,
  unique (organization_id, type, name)
);

create index if not exists production_profiles_org_status_idx
  on public.production_profiles(organization_id, status);

-- ---------------------------------------------------------------------------
-- target_profiles and versions
-- ---------------------------------------------------------------------------
create table if not exists public.target_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_family text not null check (char_length(profile_family) between 2 and 120),
  production_type text not null check (production_type in ('layer','broiler','breeder','smallholder')),
  breed_strain text not null check (char_length(breed_strain) between 1 and 120),
  housing_system text null check (housing_system is null or char_length(housing_system) <= 120),
  region text null check (region is null or char_length(region) <= 80),
  owner_user_id uuid null references auth.users(id),
  status text not null default 'draft' check (status in ('draft','active','retired')),
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id),
  version integer not null default 1
);

create index if not exists target_profiles_org_type_idx
  on public.target_profiles(organization_id, production_type, status);

create unique index if not exists target_profiles_business_key_idx
  on public.target_profiles(
    organization_id,
    profile_family,
    production_type,
    breed_strain,
    coalesce(housing_system, ''),
    coalesce(region, '')
  );

create table if not exists public.target_profile_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  target_profile_id uuid not null references public.target_profiles(id) on delete cascade,
  version text not null check (char_length(version) between 1 and 40),
  effective_from timestamptz null,
  effective_to timestamptz null,
  source_document text null check (source_document is null or char_length(source_document) <= 500),
  approval_notes text null check (approval_notes is null or char_length(approval_notes) <= 1000),
  approved_by uuid null references auth.users(id),
  approved_at timestamptz null,
  status text not null default 'draft'
    check (status in ('draft','pending_approval','approved','superseded','retired')),
  definition jsonb not null default '{}'::jsonb,
  definition_hash text null check (definition_hash is null or definition_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id),
  row_version integer not null default 1,
  unique (target_profile_id, version),
  check (effective_to is null or effective_from is null or effective_to > effective_from),
  check (
    status not in ('approved','superseded','retired')
    or (approved_by is not null and approved_at is not null and effective_from is not null and definition_hash is not null)
  )
);

create index if not exists target_profile_versions_org_status_idx
  on public.target_profile_versions(organization_id, status);

create table if not exists public.target_curve_points (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  target_profile_version_id uuid not null references public.target_profile_versions(id) on delete cascade,
  metric text not null check (char_length(metric) between 1 and 100),
  age_start_day integer not null check (age_start_day >= 0),
  age_end_day integer not null check (age_end_day >= age_start_day),
  stage text null check (stage is null or char_length(stage) <= 100),
  target_value numeric not null,
  min_value numeric null,
  max_value numeric null,
  unit text not null check (char_length(unit) between 1 and 50),
  interpolation_method text not null default 'linear'
    check (interpolation_method in ('none','linear','step')),
  created_at timestamptz not null default now(),
  unique (target_profile_version_id, metric, age_start_day, age_end_day),
  check (min_value is null or target_value >= min_value),
  check (max_value is null or target_value <= max_value)
);

create index if not exists target_curve_points_version_metric_idx
  on public.target_curve_points(target_profile_version_id, metric, age_start_day);

-- ---------------------------------------------------------------------------
-- code_sets and code_values
-- ---------------------------------------------------------------------------
create table if not exists public.code_sets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_.-]{2,80}$'),
  name text not null check (char_length(name) between 2 and 150),
  description text null check (description is null or char_length(description) <= 500),
  status text not null default 'draft' check (status in ('draft','active','inactive')),
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id),
  version integer not null default 1,
  unique (organization_id, key)
);

create table if not exists public.code_values (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code_set_id uuid not null references public.code_sets(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
  label text not null check (char_length(label) between 1 and 150),
  translations jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0 check (sort_order >= 0),
  status text not null default 'active' check (status in ('active','inactive','superseded')),
  effective_from timestamptz null,
  effective_to timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id),
  version integer not null default 1,
  unique (code_set_id, code),
  check (effective_to is null or effective_from is null or effective_to > effective_from)
);

create index if not exists code_values_org_set_status_idx
  on public.code_values(organization_id, code_set_id, status, sort_order);

-- ---------------------------------------------------------------------------
-- qr_identifiers
-- ---------------------------------------------------------------------------
create table if not exists public.qr_identifiers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null check (entity_type in (
    'house','site','zone','storage_location','asset','flock','lot','sample','shipment'
  )),
  entity_id uuid not null,
  printable_code text not null check (char_length(printable_code) between 8 and 120),
  symbology text not null default 'qr' check (symbology in ('qr','code128')),
  status text not null default 'active' check (status in ('active','replaced','retired')),
  replaced_by uuid null references public.qr_identifiers(id),
  replacement_reason text null check (replacement_reason is null or char_length(replacement_reason) <= 500),
  generated_at timestamptz not null default now(),
  generated_by uuid null references auth.users(id),
  retired_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (organization_id, printable_code)
);

create unique index if not exists qr_identifiers_entity_active_idx
  on public.qr_identifiers(organization_id, entity_type, entity_id)
  where status = 'active';

create index if not exists qr_identifiers_org_status_idx
  on public.qr_identifiers(organization_id, entity_type, status);

-- ---------------------------------------------------------------------------
-- Link MOD-01 member scopes to MOD-02 structure. Constraint creation is
-- idempotent via pg_constraint guards because ALTER TABLE lacks IF NOT EXISTS.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'member_scopes_site_id_fkey'
  ) then
    alter table public.member_scopes
      add constraint member_scopes_site_id_fkey
      foreign key (site_id) references public.sites(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'member_scopes_zone_id_fkey'
  ) then
    alter table public.member_scopes
      add constraint member_scopes_zone_id_fkey
      foreign key (zone_id) references public.biosecurity_zones(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'member_scopes_house_id_fkey'
  ) then
    alter table public.member_scopes
      add constraint member_scopes_house_id_fkey
      foreign key (house_id) references public.houses(id) on delete restrict;
  end if;
end;
$$;

commit;
