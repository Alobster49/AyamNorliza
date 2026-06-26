-- 20260625000002_mod02_structure_rls.sql
-- MOD-02 RLS policies for hierarchy, master data, target profiles and labels.

begin;

-- ---------------------------------------------------------------------------
-- Scope helper
-- ---------------------------------------------------------------------------
create or replace function public.can_access_structure_scope(
  target_org uuid,
  target_site uuid default null,
  target_zone uuid default null,
  target_house uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with actor as (
    select m.id, m.role
    from public.organization_members m
    where m.organization_id = target_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and (m.expires_at is null or m.expires_at > now())
    limit 1
  ),
  scope_count as (
    select count(*)::integer as count
    from public.member_scopes s
    join actor a on a.id = s.organization_member_id
    where s.organization_id = target_org
      and s.starts_at <= now()
      and (s.expires_at is null or s.expires_at > now())
  )
  select exists (
    select 1
    from actor a, scope_count c
    where a.role in ('owner','org_admin','farm_manager','auditor','support')
      or c.count = 0
      or exists (
        select 1
        from public.member_scopes s
        where s.organization_member_id = a.id
          and s.organization_id = target_org
          and s.starts_at <= now()
          and (s.expires_at is null or s.expires_at > now())
          and (
            (s.site_id is null and s.zone_id is null and s.house_id is null)
            or (target_site is not null and s.site_id = target_site)
            or (target_zone is not null and s.zone_id = target_zone)
            or (target_house is not null and s.house_id = target_house)
            or (
              target_house is not null
              and s.site_id is not null
              and exists (
                select 1 from public.houses h
                where h.id = target_house and h.site_id = s.site_id
              )
            )
            or (
              target_house is not null
              and s.zone_id is not null
              and exists (
                select 1 from public.houses h
                where h.id = target_house and h.zone_id = s.zone_id
              )
            )
          )
      )
  );
$$;

revoke all on function public.can_access_structure_scope(uuid, uuid, uuid, uuid) from public;
grant execute on function public.can_access_structure_scope(uuid, uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------
alter table public.sites                    enable row level security;
alter table public.biosecurity_zones        enable row level security;
alter table public.houses                   enable row level security;
alter table public.house_areas              enable row level security;
alter table public.storage_locations        enable row level security;
alter table public.production_profiles      enable row level security;
alter table public.target_profiles          enable row level security;
alter table public.target_profile_versions  enable row level security;
alter table public.target_curve_points      enable row level security;
alter table public.code_sets                enable row level security;
alter table public.code_values              enable row level security;
alter table public.qr_identifiers           enable row level security;

grant select, insert, update, delete on
  public.sites,
  public.biosecurity_zones,
  public.houses,
  public.house_areas,
  public.storage_locations,
  public.production_profiles,
  public.target_profiles,
  public.target_profile_versions,
  public.target_curve_points,
  public.code_sets,
  public.code_values,
  public.qr_identifiers
to authenticated;

-- ---------------------------------------------------------------------------
-- Hierarchy policies
-- ---------------------------------------------------------------------------
create policy sites_select_scope
  on public.sites for select to authenticated
  using (public.can_access_structure_scope(organization_id, id, null, null));

create policy sites_insert_manager
  on public.sites for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager']));

create policy sites_update_manager
  on public.sites for update to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager']));

create policy zones_select_scope
  on public.biosecurity_zones for select to authenticated
  using (public.can_access_structure_scope(organization_id, site_id, id, null));

create policy zones_write_manager
  on public.biosecurity_zones for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','biosecurity_qa']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','biosecurity_qa']));

create policy houses_select_scope
  on public.houses for select to authenticated
  using (public.can_access_structure_scope(organization_id, site_id, zone_id, id));

create policy houses_write_manager
  on public.houses for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager']));

create policy house_areas_select_scope
  on public.house_areas for select to authenticated
  using (public.can_access_structure_scope(organization_id, site_id, null, house_id));

create policy house_areas_write_manager
  on public.house_areas for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager']));

create policy storage_locations_select_scope
  on public.storage_locations for select to authenticated
  using (public.can_access_structure_scope(organization_id, site_id, zone_id, null));

create policy storage_locations_write_manager
  on public.storage_locations for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','inventory']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','inventory']));

-- ---------------------------------------------------------------------------
-- Shared master data policies
-- ---------------------------------------------------------------------------
create policy production_profiles_select_member
  on public.production_profiles for select to authenticated
  using (public.is_active_org_member(organization_id));

create policy production_profiles_write_admin
  on public.production_profiles for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager']));

create policy target_profiles_select_member
  on public.target_profiles for select to authenticated
  using (public.is_active_org_member(organization_id));

create policy target_profiles_write_admin
  on public.target_profiles for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager']));

create policy target_versions_select_member
  on public.target_profile_versions for select to authenticated
  using (public.is_active_org_member(organization_id));

create policy target_versions_write_admin
  on public.target_profile_versions for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','veterinarian','biosecurity_qa']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','veterinarian','biosecurity_qa']));

create policy target_curve_points_select_member
  on public.target_curve_points for select to authenticated
  using (public.is_active_org_member(organization_id));

create policy target_curve_points_write_admin
  on public.target_curve_points for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','veterinarian','biosecurity_qa']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','veterinarian','biosecurity_qa']));

create policy code_sets_select_member
  on public.code_sets for select to authenticated
  using (public.is_active_org_member(organization_id));

create policy code_sets_write_admin
  on public.code_sets for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager']));

create policy code_values_select_member
  on public.code_values for select to authenticated
  using (public.is_active_org_member(organization_id));

create policy code_values_write_admin
  on public.code_values for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager']));

create policy qr_identifiers_select_member
  on public.qr_identifiers for select to authenticated
  using (public.is_active_org_member(organization_id));

create policy qr_identifiers_write_admin
  on public.qr_identifiers for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','inventory','logistics']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','farm_manager','inventory','logistics']));

commit;
