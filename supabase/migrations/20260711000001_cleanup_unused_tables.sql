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

-- Triggers on the tables below are dropped implicitly when their owning
-- table is dropped further down, so no separate DROP TRIGGER statements are
-- needed here (DROP TRIGGER ... ON public.x errors if x doesn't exist,
-- unlike DROP TABLE IF EXISTS).

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
