-- 20260711000001_cleanup_unused_tables.sql
-- Cleanup migration: Drop tables, triggers, and functions for MOD-02, MOD-03, MOD-04
-- that are not currently used in the application code.
--
-- This migration drops:
--   - MOD-02 (Farm Structure/Master Data): houses, house_areas, storage_locations,
--     production_profiles, target_profiles, target_profile_versions, target_curve_points,
--     code_sets, code_values, qr_identifiers
--   - MOD-03 (Flock Lifecycle): flocks, flock_plans, house_readiness_reviews,
--     placements, flock_movements, flock_count_transactions, flock_stage_history,
--     harvest_plans, flock_closeouts
--   - MOD-04 (Daily Operations): shifts, shift_assignments, observations, handovers,
--     inspection_templates, inspection_template_versions, inspections, inspection_responses,
--     period_closes, record_corrections, sync_operations
--
-- Also drops related triggers and functions.
--
-- Tables kept (actively used):
--   organizations, profiles, organization_members, member_scopes, invitations,
--   access_reviews, access_review_items, support_sessions, break_glass_events,
--   auth_security_events, audit_log

begin;

-- ============================================================================
-- DROP TRIGGERS for unused tables
-- ============================================================================
drop trigger if exists code_sets_set_updated_at on public.code_sets;
drop trigger if exists code_values_set_updated_at on public.code_values;
drop trigger if exists flock_plans_set_updated_at on public.flock_plans;
drop trigger if exists flocks_set_updated_at on public.flocks;
drop trigger if exists flocks_status_transition on public.flocks;
drop trigger if exists harvest_plans_set_updated_at on public.harvest_plans;
drop trigger if exists house_areas_set_updated_at on public.house_areas;
drop trigger if exists houses_set_updated_at on public.houses;
drop trigger if exists houses_status_transition on public.houses;
drop trigger if exists inspection_template_versions_updated_at on public.inspection_template_versions;
drop trigger if exists inspection_templates_updated_at on public.inspection_templates;
drop trigger if exists inspections_updated_at on public.inspections;
drop trigger if exists inspections_no_locked_update on public.inspections;
drop trigger if exists period_closes_updated_at on public.period_closes;
drop trigger if exists period_closes_no_locked_update on public.period_closes;
drop trigger if exists production_profiles_set_updated_at on public.production_profiles;
drop trigger if exists shifts_updated_at on public.shifts;
drop trigger if exists storage_locations_set_updated_at on public.storage_locations;
drop trigger if exists sync_operations_processed_at on public.sync_operations;
drop trigger if exists target_curve_points_approved_immutable on public.target_curve_points;
drop trigger if exists target_curve_points_set_updated_at on public.target_curve_points;
drop trigger if exists target_profile_versions_immutable on public.target_profile_versions;
drop trigger if exists target_profile_versions_set_updated_at on public.target_profile_versions;
drop trigger if exists target_profiles_set_updated_at on public.target_profiles;

-- ============================================================================
-- DROP FUNCTIONS for unused tables
-- ============================================================================
drop function if exists public.check_flock_status_transition();
drop function if exists public.check_house_status_transition();
drop function if exists public.check_target_profile_version_mutation();
drop function if exists public.deny_approved_curve_point_mutation();

-- ============================================================================
-- REMOVE FK CONSTRAINTS from active tables to dropped tables
-- ============================================================================
alter table public.member_scopes drop constraint if exists member_scopes_house_id_fkey;
alter table public.member_scopes drop constraint if exists member_scopes_zone_id_fkey;
alter table public.member_scopes drop constraint if exists member_scopes_site_id_fkey;

-- ============================================================================
-- DROP TABLES in dependency order (deepest first)
-- ============================================================================

-- Tier 1: No dependencies from other unused tables
drop table if exists public.code_values;
drop table if exists public.flock_closeouts;
drop table if exists public.flock_count_transactions;
drop table if exists public.flock_movements;
drop table if exists public.flock_stage_history;
drop table if exists public.house_readiness_reviews;
drop table if exists public.inspection_responses;
drop table if exists public.observations;
drop table if exists public.placements;
drop table if exists public.record_corrections;

-- Tier 2
drop table if exists public.flock_plans;
drop table if exists public.inspections;
drop table if exists public.inspection_template_versions;
drop table if exists public.inspection_templates;
drop table if exists public.shift_assignments;
drop table if exists public.target_curve_points;

-- Tier 3
drop table if exists public.harvest_plans;
drop table if exists public.handovers;
drop table if exists public.shifts;
drop table if exists public.flocks;
drop table if exists public.target_profile_versions;

-- Tier 4
drop table if exists public.code_sets;
drop table if exists public.house_areas;
drop table if exists public.period_closes;
drop table if exists public.houses;
drop table if exists public.production_profiles;
drop table if exists public.qr_identifiers;
drop table if exists public.target_profiles;

-- Tier 5-7
drop table if exists public.storage_locations;
drop table if exists public.biosecurity_zones;
drop table if exists public.sites;
drop table if exists public.sync_operations;

commit;
