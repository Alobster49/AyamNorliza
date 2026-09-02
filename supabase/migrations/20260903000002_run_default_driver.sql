-- When Dispatch creates a run (first order assigned, or depart), the run's
-- driver defaults from the roster: today's cover first, else the truck's
-- regular driver — unless that driver has approved leave on the run date.
-- dispatch_assign_driver still overrides per run.

create or replace function public.delivery_runs_default_driver()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_driver uuid;
begin
  if new.driver_id is not null then
    return new;
  end if;

  select c.driver_id into v_driver
  from public.truck_covers c
  where c.truck_id = new.truck_id and c.cover_date = new.run_date;

  if v_driver is null then
    select t.regular_driver_id into v_driver
    from public.trucks t
    where t.id = new.truck_id;
  end if;

  if v_driver is not null and exists (
    select 1 from public.leave_requests r
    where r.organization_id = new.organization_id
      and r.user_id = v_driver
      and r.status = 'approved'
      and new.run_date between r.start_date and r.end_date
  ) then
    v_driver := null;
  end if;

  new.driver_id := v_driver;
  return new;
end;
$$;

drop trigger if exists delivery_runs_default_driver on public.delivery_runs;
create trigger delivery_runs_default_driver
  before insert on public.delivery_runs
  for each row execute function public.delivery_runs_default_driver();
