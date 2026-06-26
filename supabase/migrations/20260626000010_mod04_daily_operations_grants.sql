-- 20260626000010_mod04_daily_operations_grants.sql
-- MOD-04 explicit grants for API roles.

begin;

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on
  public.shifts,
  public.shift_assignments,
  public.inspection_templates,
  public.inspection_template_versions,
  public.inspections,
  public.inspection_responses,
  public.observations,
  public.handovers,
  public.period_closes,
  public.record_corrections,
  public.sync_operations
to authenticated, service_role;

grant execute on function public.is_daily_record_locked(text, uuid) to authenticated, service_role;
grant execute on function public.set_sync_operation_processed_at() to service_role;

commit;
