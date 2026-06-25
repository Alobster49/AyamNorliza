-- 20260624000001_id_access_core.sql
-- MOD-01 core schema: tenants, profiles, membership, scopes, invitations,
-- access reviews, support sessions, break-glass, security events, audit log.
--
-- Conventions (from documentation/Planing/shared-data-security-architecture.md §26):
--   - UUID primary keys (uuid_generate_v4 / gen_random_uuid).
--   - timestamptz in UTC, stored as text in PG.
--   - Soft status over hard delete; append-only events for history.
--   - Idempotency column client_operation_id for offline-friendly flows.
--   - Explicit FKs, check constraints, and (where useful) unique constraints
--     on idempotency / business keys.
--
-- This file is intentionally RLS-free; RLS lives in the next migration so
-- policies can reference helpers defined together.

begin;

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$'),
  name text not null check (char_length(name) between 2 and 150),
  legal_name text null,
  region text null,
  default_time_zone text not null default 'UTC'
    check (default_time_zone ~ '^[A-Za-z]+/[A-Za-z_]+$|^UTC$'),
  default_locale text not null default 'en'
    check (char_length(default_locale) between 2 and 10),
  status text not null default 'active'
    check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  created_by uuid null,
  updated_at timestamptz not null default now(),
  updated_by uuid null,
  version integer not null default 1
);

comment on table public.organizations is
  'Tenant / data-ownership boundary. One row per organization.';

-- ---------------------------------------------------------------------------
-- profiles (extends auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 150),
  locale text not null default 'en' check (char_length(locale) between 2 and 10),
  time_zone text not null default 'UTC'
    check (time_zone ~ '^[A-Za-z]+/[A-Za-z_]+$|^UTC$'),
  contact_preferences jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

comment on table public.profiles is
  'Profile data that extends auth.users; key field for audit attribution.';

-- ---------------------------------------------------------------------------
-- organization_members
-- ---------------------------------------------------------------------------
create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in (
    'owner','org_admin','farm_manager','supervisor','caretaker',
    'veterinarian','biosecurity_qa','maintenance','inventory',
    'logistics','auditor','support'
  )),
  status text not null default 'active'
    check (status in ('invited','active','suspended','expired')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz null,
  invited_by uuid null references auth.users(id),
  sponsor_id uuid null references auth.users(id),
  client_operation_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (organization_id, user_id),
  check (expires_at is null or expires_at > starts_at),
  check (
    (role <> 'support') or (sponsor_id is not null)
  )
);

create index if not exists organization_members_user_active_idx
  on public.organization_members(user_id)
  where status = 'active';

create index if not exists organization_members_org_role_active_idx
  on public.organization_members(organization_id, role)
  where status = 'active';

create unique index if not exists organization_members_client_op_idempotent_idx
  on public.organization_members(organization_id, user_id, client_operation_id)
  where client_operation_id is not null;

-- ---------------------------------------------------------------------------
-- member_scopes
-- ---------------------------------------------------------------------------
create table if not exists public.member_scopes (
  id uuid primary key default gen_random_uuid(),
  organization_member_id uuid not null references public.organization_members(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid null,
  zone_id uuid null,
  house_id uuid null,
  permission text null check (char_length(permission) <= 100),
  starts_at timestamptz not null default now(),
  expires_at timestamptz null,
  created_at timestamptz not null default now(),
  check (
    (case when site_id is null then 0 else 1 end) +
    (case when zone_id is null then 0 else 1 end) +
    (case when house_id is null then 0 else 1 end) <= 1
  ),
  check (expires_at is null or expires_at > starts_at)
);

create index if not exists member_scopes_member_idx
  on public.member_scopes(organization_member_id);

create index if not exists member_scopes_org_site_idx
  on public.member_scopes(organization_id, site_id);

create index if not exists member_scopes_org_house_idx
  on public.member_scopes(organization_id, house_id);

-- ---------------------------------------------------------------------------
-- invitations
-- ---------------------------------------------------------------------------
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email citext not null,
  role text not null check (role in (
    'owner','org_admin','farm_manager','supervisor','caretaker',
    'veterinarian','biosecurity_qa','maintenance','inventory',
    'logistics','auditor','support'
  )),
  proposed_scopes jsonb not null default '[]'::jsonb,
  token_hash text not null,
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  accepted_at timestamptz null,
  revoked_at timestamptz null,
  client_operation_id uuid null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create unique index if not exists invitations_token_hash_idx
  on public.invitations(token_hash);

create unique index if not exists invitations_client_op_idx
  on public.invitations(client_operation_id)
  where client_operation_id is not null;

create index if not exists invitations_open_idx
  on public.invitations(organization_id, email)
  where accepted_at is null and revoked_at is null;

-- ---------------------------------------------------------------------------
-- access_reviews
-- ---------------------------------------------------------------------------
create table if not exists public.access_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  reviewer_id uuid not null references auth.users(id),
  status text not null default 'open'
    check (status in ('open','in_progress','completed','cancelled')),
  due_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  check (period_end > period_start),
  check (due_at >= period_start)
);

create index if not exists access_reviews_org_status_idx
  on public.access_reviews(organization_id, status);

create table if not exists public.access_review_items (
  id uuid primary key default gen_random_uuid(),
  access_review_id uuid not null references public.access_reviews(id) on delete cascade,
  organization_member_id uuid not null references public.organization_members(id) on delete cascade,
  decision text not null default 'pending'
    check (decision in ('keep','modify','revoke','pending')),
  decision_reason text null check (char_length(decision_reason) <= 1000),
  evidence jsonb not null default '{}'::jsonb,
  decided_at timestamptz null,
  decided_by uuid null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists access_review_items_review_idx
  on public.access_review_items(access_review_id);

create index if not exists access_review_items_member_idx
  on public.access_review_items(organization_member_id);

-- ---------------------------------------------------------------------------
-- support_sessions
-- ---------------------------------------------------------------------------
create table if not exists public.support_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sponsor_id uuid not null references auth.users(id),
  technician_id uuid not null references auth.users(id),
  purpose text not null check (char_length(purpose) between 5 and 500),
  permitted_scopes jsonb not null default '[]'::jsonb,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  recording_reference text null,
  status text not null default 'active'
    check (status in ('scheduled','active','ended','revoked')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at <= starts_at + interval '24 hours')
);

create index if not exists support_sessions_org_status_idx
  on public.support_sessions(organization_id, status);

create index if not exists support_sessions_technician_idx
  on public.support_sessions(technician_id, status);

-- ---------------------------------------------------------------------------
-- break_glass_events
-- ---------------------------------------------------------------------------
create table if not exists public.break_glass_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  reason text not null check (char_length(reason) between 10 and 500),
  ticket_reference text null check (char_length(ticket_reference) <= 100),
  approved_by uuid null references auth.users(id),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz null,
  post_use_review jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (expires_at > starts_at),
  check (expires_at <= starts_at + interval '60 minutes')
);

create index if not exists break_glass_org_user_active_idx
  on public.break_glass_events(organization_id, user_id)
  where ended_at is null;

create index if not exists break_glass_org_recent_idx
  on public.break_glass_events(organization_id, starts_at desc);

-- ---------------------------------------------------------------------------
-- auth_security_events
-- ---------------------------------------------------------------------------
create table if not exists public.auth_security_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  organization_id uuid null references public.organizations(id) on delete set null,
  event_type text not null check (event_type in (
    'login_success','login_failure','mfa_enroll','mfa_unenroll','mfa_challenge_success',
    'mfa_challenge_failure','password_reset','token_refresh',
    'session_revoke','suspicious_activity'
  )),
  ip inet null,
  user_agent text null,
  geo_country text null check (char_length(geo_country) <= 2),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists auth_security_events_user_time_idx
  on public.auth_security_events(user_id, occurred_at desc);

create index if not exists auth_security_events_org_type_time_idx
  on public.auth_security_events(organization_id, event_type, occurred_at desc);

-- ---------------------------------------------------------------------------
-- audit_log (append-only; created here so MOD-01 can write into it)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null references public.organizations(id) on delete set null,
  actor_user_id uuid null references auth.users(id) on delete set null,
  actor_role text null,
  actor_session_id uuid null,
  event_type text not null check (char_length(event_type) between 3 and 120),
  entity_type text not null check (char_length(entity_type) between 1 and 80),
  entity_id uuid null,
  before jsonb null,
  after jsonb null,
  reason text null check (char_length(reason) <= 1000),
  correlation_id uuid null,
  client_operation_id uuid null,
  source text not null check (source in ('web','mobile','device','integration','job','import','server')),
  occurred_at timestamptz not null default now()
);

create index if not exists audit_log_org_time_idx
  on public.audit_log(organization_id, occurred_at desc);

create index if not exists audit_log_entity_time_idx
  on public.audit_log(entity_type, entity_id, occurred_at desc);

create index if not exists audit_log_actor_time_idx
  on public.audit_log(actor_user_id, occurred_at desc);

commit;
