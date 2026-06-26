-- 20260626000008_mod04_daily_operations_triggers.sql
-- MOD-04 triggers: updated_at/version maintenance, lock protection and sync processed timestamps.

begin;

create or replace function public.is_daily_record_locked(target_table text, target_record_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case target_table
    when 'inspections' then exists (
      select 1 from public.inspections where id = target_record_id and status = 'locked'
    )
    when 'period_closes' then exists (
      select 1 from public.period_closes where id = target_record_id and status = 'locked'
    )
    when 'inspection_responses' then exists (
      select 1
      from public.inspection_responses r
      join public.inspections i on i.id = r.inspection_id
      where r.id = target_record_id and i.status = 'locked'
    )
    when 'observations' then exists (
      select 1
      from public.observations o
      left join public.inspections i on i.id = o.inspection_id
      where o.id = target_record_id and coalesce(i.status = 'locked', false)
    )
    else false
  end;
$$;

revoke all on function public.is_daily_record_locked(text, uuid) from public;
grant execute on function public.is_daily_record_locked(text, uuid) to authenticated;

create or replace function public.prevent_locked_daily_record_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'locked' then
    raise exception 'locked daily operation records require correction workflow';
  end if;
  return new;
end;
$$;

drop trigger if exists inspections_no_locked_update on public.inspections;
create trigger inspections_no_locked_update
  before update on public.inspections
  for each row execute function public.prevent_locked_daily_record_update();

drop trigger if exists period_closes_no_locked_update on public.period_closes;
create trigger period_closes_no_locked_update
  before update on public.period_closes
  for each row execute function public.prevent_locked_daily_record_update();

create or replace function public.set_sync_operation_processed_at()
returns trigger
language plpgsql
as $$
begin
  if new.processed_at is null and new.result in ('accepted','duplicate','conflict','rejected') then
    new.processed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists sync_operations_processed_at on public.sync_operations;
create trigger sync_operations_processed_at
  before insert or update on public.sync_operations
  for each row execute function public.set_sync_operation_processed_at();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'shifts',
    'inspection_templates',
    'inspection_template_versions',
    'inspections',
    'period_closes'
  ]
  loop
    execute format('drop trigger if exists %I_updated_at on public.%I', table_name, table_name);
    execute format(
      'create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name,
      table_name
    );
  end loop;
end;
$$;

commit;
