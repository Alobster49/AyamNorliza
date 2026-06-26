-- 20260625000003_mod02_structure_triggers.sql
-- MOD-02 triggers: updated_at, house status transitions and target version
-- immutability after approval.

begin;

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'sites',
      'biosecurity_zones',
      'houses',
      'house_areas',
      'storage_locations',
      'production_profiles',
      'target_profiles',
      'target_profile_versions',
      'code_sets',
      'code_values'
    ])
  loop
    execute format(
      'drop trigger if exists %I_set_updated_at on public.%I;
       create trigger %I_set_updated_at
         before update on public.%I
         for each row execute function public.set_updated_at();',
      t, t, t, t
    );
  end loop;
end;
$$;

create or replace function public.check_house_status_transition()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if old.operational_status = 'retired' and new.operational_status <> 'retired' then
      raise exception 'retired houses cannot be reactivated'
        using errcode = 'check_violation';
    end if;

    if old.operational_status <> 'draft' and new.operational_status = 'draft' then
      raise exception 'house status cannot return to draft'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists houses_status_transition on public.houses;
create trigger houses_status_transition
  before update on public.houses
  for each row execute function public.check_house_status_transition();

create or replace function public.check_target_profile_version_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and old.status in ('approved','superseded','retired') then
    if new.target_profile_id <> old.target_profile_id
      or new.version <> old.version
      or new.source_document is distinct from old.source_document
      or new.approval_notes is distinct from old.approval_notes
      or new.approved_by is distinct from old.approved_by
      or new.approved_at is distinct from old.approved_at
      or new.definition::text <> old.definition::text
      or new.definition_hash is distinct from old.definition_hash
    then
      raise exception 'approved target profile versions are immutable'
        using errcode = 'check_violation';
    end if;

    if old.status = 'approved' and new.status in ('superseded','retired') then
      return new;
    end if;

    if new.status <> old.status or new.effective_from is distinct from old.effective_from then
      raise exception 'approved target profile versions can only be superseded or retired'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists target_profile_versions_immutable on public.target_profile_versions;
create trigger target_profile_versions_immutable
  before update on public.target_profile_versions
  for each row execute function public.check_target_profile_version_mutation();

create or replace function public.deny_approved_curve_point_mutation()
returns trigger
language plpgsql
as $$
declare
  version_status text;
begin
  select status into version_status
  from public.target_profile_versions
  where id = coalesce(new.target_profile_version_id, old.target_profile_version_id);

  if version_status in ('approved','superseded','retired') then
    raise exception 'curve points for approved target profile versions are immutable'
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists target_curve_points_approved_immutable on public.target_curve_points;
create trigger target_curve_points_approved_immutable
  before insert or update or delete on public.target_curve_points
  for each row execute function public.deny_approved_curve_point_mutation();

commit;
