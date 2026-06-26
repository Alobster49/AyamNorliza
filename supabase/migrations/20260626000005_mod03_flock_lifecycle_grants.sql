-- 20260626000005_mod03_flock_lifecycle_grants.sql
-- Forward-only privilege repair for live projects after MOD-03 tables land.

begin;

grant select, insert, update, delete on
  public.flocks,
  public.flock_plans,
  public.house_readiness_reviews,
  public.placements,
  public.flock_movements,
  public.flock_count_transactions,
  public.flock_stage_history,
  public.harvest_plans,
  public.flock_closeouts
to authenticated;

commit;
