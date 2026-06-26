-- 20260626000007_mod04_daily_operations_rls.sql
-- MOD-04 RLS policies for daily operations.

begin;

alter table public.shifts enable row level security;
alter table public.shift_assignments enable row level security;
alter table public.inspection_templates enable row level security;
alter table public.inspection_template_versions enable row level security;
alter table public.inspections enable row level security;
alter table public.inspection_responses enable row level security;
alter table public.observations enable row level security;
alter table public.handovers enable row level security;
alter table public.period_closes enable row level security;
alter table public.record_corrections enable row level security;
alter table public.sync_operations enable row level security;

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
to authenticated;

create policy shifts_select_scope on public.shifts for select to authenticated
  using (public.can_access_structure_scope(organization_id, site_id, null, null));
create policy shifts_write_config on public.shifts for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor']));

create policy assignments_select_scope on public.shift_assignments for select to authenticated
  using (public.can_access_structure_scope(organization_id, site_id, null, house_id) or user_id = auth.uid());
create policy assignments_write_config on public.shift_assignments for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor']));

create policy templates_select_member on public.inspection_templates for select to authenticated
  using (public.is_active_org_member(organization_id));
create policy templates_write_config on public.inspection_templates for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','biosecurity_qa','veterinarian']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','biosecurity_qa','veterinarian']));

create policy template_versions_select_member on public.inspection_template_versions for select to authenticated
  using (public.is_active_org_member(organization_id));
create policy template_versions_write_config on public.inspection_template_versions for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','biosecurity_qa','veterinarian']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','biosecurity_qa','veterinarian']));

create policy inspections_select_scope on public.inspections for select to authenticated
  using (public.can_access_structure_scope(organization_id, site_id, null, house_id));
create policy inspections_write_recorders on public.inspections for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','caretaker','veterinarian','biosecurity_qa','maintenance']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','caretaker','veterinarian','biosecurity_qa','maintenance']));

create policy responses_select_via_inspection on public.inspection_responses for select to authenticated
  using (exists (
    select 1 from public.inspections i
    where i.id = inspection_id
      and public.can_access_structure_scope(i.organization_id, i.site_id, null, i.house_id)
  ));
create policy responses_write_recorders on public.inspection_responses for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','caretaker','veterinarian','biosecurity_qa','maintenance']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','caretaker','veterinarian','biosecurity_qa','maintenance']));

create policy observations_select_scope on public.observations for select to authenticated
  using (public.can_access_structure_scope(organization_id, site_id, null, house_id));
create policy observations_write_recorders on public.observations for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','caretaker','veterinarian','biosecurity_qa','maintenance']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','caretaker','veterinarian','biosecurity_qa','maintenance']));

create policy handovers_select_scope on public.handovers for select to authenticated
  using (public.can_access_structure_scope(organization_id, site_id, null, null));
create policy handovers_write_ops on public.handovers for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','caretaker']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','caretaker']));

create policy period_closes_select_scope on public.period_closes for select to authenticated
  using (public.can_access_structure_scope(organization_id, site_id, null, house_id));
create policy period_closes_write_reviewers on public.period_closes for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor']));

create policy corrections_select_member on public.record_corrections for select to authenticated
  using (public.is_active_org_member(organization_id));
create policy corrections_write_reviewers on public.record_corrections for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','biosecurity_qa']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','biosecurity_qa']));

create policy sync_select_own_or_review on public.sync_operations for select to authenticated
  using (user_id = auth.uid() or public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor']));
create policy sync_write_recorders on public.sync_operations for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','caretaker','veterinarian','biosecurity_qa','maintenance']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','caretaker','veterinarian','biosecurity_qa','maintenance']));

commit;
