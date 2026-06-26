-- 20260626000002_mod03_flock_lifecycle_rls.sql
-- MOD-03 RLS policies for flock lifecycle tables.

begin;

alter table public.flocks                   enable row level security;
alter table public.flock_plans              enable row level security;
alter table public.house_readiness_reviews  enable row level security;
alter table public.placements               enable row level security;
alter table public.flock_movements          enable row level security;
alter table public.flock_count_transactions enable row level security;
alter table public.flock_stage_history      enable row level security;
alter table public.harvest_plans            enable row level security;
alter table public.flock_closeouts          enable row level security;

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

create policy flocks_select_scope
  on public.flocks for select to authenticated
  using (public.can_access_structure_scope(organization_id, site_id, null, house_id));

create policy flocks_write_manager
  on public.flocks for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor']));

create policy flock_plans_select_scope
  on public.flock_plans for select to authenticated
  using (public.can_access_structure_scope(organization_id, site_id, null, house_id));

create policy flock_plans_write_manager
  on public.flock_plans for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','veterinarian','biosecurity_qa']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','veterinarian','biosecurity_qa']));

create policy readiness_select_scope
  on public.house_readiness_reviews for select to authenticated
  using (public.can_access_structure_scope(organization_id, site_id, null, house_id));

create policy readiness_write_qa_manager
  on public.house_readiness_reviews for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','biosecurity_qa']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','biosecurity_qa']));

create policy placements_select_scope
  on public.placements for select to authenticated
  using (public.can_access_structure_scope(organization_id, site_id, null, house_id));

create policy placements_write_ops
  on public.placements for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','caretaker','logistics']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','caretaker','logistics']));

create policy movements_select_scope
  on public.flock_movements for select to authenticated
  using (public.can_access_structure_scope(organization_id, site_id, null, source_house_id));

create policy movements_write_ops
  on public.flock_movements for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','logistics']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','logistics']));

create policy count_transactions_select_scope
  on public.flock_count_transactions for select to authenticated
  using (public.can_access_structure_scope(organization_id, site_id, null, house_id));

create policy count_transactions_write_ops
  on public.flock_count_transactions for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','caretaker','veterinarian','logistics']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','caretaker','veterinarian','logistics']));

create policy stage_history_select_scope
  on public.flock_stage_history for select to authenticated
  using (public.can_access_structure_scope(organization_id, site_id, null, house_id));

create policy stage_history_write_manager
  on public.flock_stage_history for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','veterinarian']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','veterinarian']));

create policy harvest_plans_select_scope
  on public.harvest_plans for select to authenticated
  using (public.can_access_structure_scope(organization_id, site_id, null, house_id));

create policy harvest_plans_write_logistics
  on public.harvest_plans for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','logistics']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','supervisor','logistics']));

create policy closeouts_select_scope
  on public.flock_closeouts for select to authenticated
  using (public.can_access_structure_scope(organization_id, site_id, null, house_id));

create policy closeouts_write_manager
  on public.flock_closeouts for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager']));

commit;
