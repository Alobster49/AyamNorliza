-- 20260626000003_mod03_flock_lifecycle_triggers.sql
-- MOD-03 triggers: updated_at, lifecycle transition validation and closed
-- flock lock protection.

begin;

create or replace function public.is_valid_flock_status_transition(old_status text, new_status text)
returns boolean
language sql
immutable
as $$
  select old_status = new_status
    or case old_status
      when 'draft' then new_status in ('planned')
      when 'planned' then new_status in ('readiness_pending')
      when 'readiness_pending' then new_status in ('ready')
      when 'ready' then new_status in ('active')
      when 'active' then new_status in ('restricted','harvest_pending','depopulated')
      when 'restricted' then new_status in ('active')
      when 'harvest_pending' then new_status in ('depopulated')
      when 'depopulated' then new_status in ('closing')
      when 'closing' then new_status in ('closed')
      else false
    end;
$$;

revoke all on function public.is_valid_flock_status_transition(text, text) from public;
grant execute on function public.is_valid_flock_status_transition(text, text) to authenticated;

create or replace function public.check_flock_status_transition()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'closed' then
      raise exception 'closed flocks are locked'
        using errcode = 'check_violation';
    end if;

    if not public.is_valid_flock_status_transition(old.status, new.status) then
      raise exception 'invalid flock status transition from % to %', old.status, new.status
        using errcode = 'check_violation';
    end if;

    if new.status = 'closed' then
      new.closed_at := coalesce(new.closed_at, now());
      new.closed_by := coalesce(new.closed_by, (select auth.uid()));
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists flocks_set_updated_at on public.flocks;
create trigger flocks_set_updated_at
  before update on public.flocks
  for each row execute function public.set_updated_at();

drop trigger if exists flocks_status_transition on public.flocks;
create trigger flocks_status_transition
  before update on public.flocks
  for each row execute function public.check_flock_status_transition();

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'flock_plans',
      'harvest_plans'
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

commit;
