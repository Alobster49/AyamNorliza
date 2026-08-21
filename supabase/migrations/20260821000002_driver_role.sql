-- 20260821000002_driver_role.sql
-- Delivery runs redesign, phase 3: a driver role that can only see its own run.
--
-- Every org-member policy on the order pipeline is written as "any active
-- member of the org", which is right for office staff and wrong for a driver:
-- a driver signing in on a phone in a customer's car park would otherwise be
-- able to read every order, every customer and every phone number the business
-- has. So this migration does two things at once -- it adds the role, and it
-- narrows the existing member policies to exclude it, replacing them with
-- driver policies scoped to the run the driver is actually assigned to.
--
-- A driver is attached to a run, not to a truck: drivers swap vehicles, and
-- the run is the thing that has a date on it.
--
-- Writes stay RPC-only for drivers, exactly as they are for everyone else.
-- The driver deck's own write path (arrive, deliver, fail) lands in the next
-- migration; this one deliberately grants read and nothing more.

begin;

-- ---------------------------------------------------------------------------
-- 1. Role constraints
-- ---------------------------------------------------------------------------
alter table public.organization_members drop constraint if exists organization_members_role_check;
alter table public.organization_members add constraint organization_members_role_check
  check (role in (
    'owner','org_admin','seller','driver','farm_manager','supervisor','caretaker',
    'veterinarian','biosecurity_qa','maintenance','inventory',
    'logistics','auditor','support'
  ));

alter table public.invitations drop constraint if exists invitations_role_check;
alter table public.invitations add constraint invitations_role_check
  check (role in (
    'owner','org_admin','seller','driver','farm_manager','supervisor','caretaker',
    'veterinarian','biosecurity_qa','maintenance','inventory',
    'logistics','auditor','support'
  ));

alter table public.role_capability_overrides drop constraint if exists role_capability_overrides_role_check;
alter table public.role_capability_overrides add constraint role_capability_overrides_role_check
  check (role in (
    'owner','org_admin','seller','driver','farm_manager','supervisor','caretaker',
    'veterinarian','biosecurity_qa','maintenance','inventory',
    'logistics','auditor','support'
  ));

-- ---------------------------------------------------------------------------
-- 2. The driver on a run
-- ---------------------------------------------------------------------------
alter table public.delivery_runs
  add column if not exists driver_id uuid null references auth.users(id) on delete set null;

comment on column public.delivery_runs.driver_id is
  'The user driving this run. Scopes what a driver-role member can read.';

create index if not exists delivery_runs_driver_idx on public.delivery_runs(driver_id)
  where driver_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Helper: is the caller a driver in this org?
--
-- Security definer so it can read organization_members without tripping that
-- table's own RLS from inside a policy.
-- ---------------------------------------------------------------------------
create or replace function public.is_org_driver(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = target_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and (m.expires_at is null or m.expires_at > now())
      and m.role = 'driver'
  );
$$;

revoke all on function public.is_org_driver(uuid) from public;
grant execute on function public.is_org_driver(uuid) to authenticated;

-- Runs the caller is driving. Used by every driver policy below.
create or replace function public.driver_run_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.delivery_runs where driver_id = (select auth.uid());
$$;

revoke all on function public.driver_run_ids() from public;
grant execute on function public.driver_run_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Narrow the existing member policies so a driver no longer matches them.
--
-- Permissive policies OR together, so leaving any of these as "any active
-- member" would hand the whole org back to the driver regardless of what the
-- driver policies say.
-- ---------------------------------------------------------------------------
drop policy if exists "delivery_runs_select" on public.delivery_runs;
create policy "delivery_runs_select" on public.delivery_runs
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
        and (expires_at is null or expires_at > now())
        and role <> 'driver'
    )
  );

drop policy if exists "orders_select_member" on public.orders;
create policy "orders_select_member" on public.orders
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
        and (expires_at is null or expires_at > now())
        and role <> 'driver'
    )
  );

drop policy if exists "order_items_select_member" on public.order_items;
create policy "order_items_select_member" on public.order_items
  for select to authenticated using (
    order_id in (
      select id from public.orders
      where organization_id in (
        select organization_id from public.organization_members
        where user_id = auth.uid() and status = 'active'
          and (expires_at is null or expires_at > now())
          and role <> 'driver'
      )
    )
  );

drop policy if exists "customers_select" on public.customers;
create policy "customers_select" on public.customers
  for select using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and role <> 'driver'
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Driver policies: this run, and the things hanging off it.
-- ---------------------------------------------------------------------------
create policy "delivery_runs_select_driver" on public.delivery_runs
  for select to authenticated using (
    driver_id = auth.uid() and public.is_org_driver(organization_id)
  );

create policy "orders_select_driver" on public.orders
  for select to authenticated using (
    run_id in (select public.driver_run_ids())
  );

create policy "order_items_select_driver" on public.order_items
  for select to authenticated using (
    order_id in (
      select id from public.orders where run_id in (select public.driver_run_ids())
    )
  );

-- A driver needs the name and phone of the customers on today's run, and no
-- others.
create policy "customers_select_driver" on public.customers
  for select to authenticated using (
    id in (
      select customer_id from public.orders where run_id in (select public.driver_run_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- 6. dispatch_assign_driver: the office puts a driver on a run.
--
-- The driver has to be an active driver-role member of the same org, so a
-- typo'd uuid cannot quietly hand a stranger a customer list. Passing null
-- takes the driver off the run.
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_assign_driver(p_run uuid, p_driver uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_status public.delivery_run_status;
begin
  select organization_id, status into v_org, v_status
  from public.delivery_runs where id = p_run for update;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.has_org_role(v_org, array['owner', 'org_admin', 'seller', 'logistics']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_status = 'completed' then
    raise exception using errcode = 'P0001', message = 'run_completed';
  end if;

  if p_driver is not null and not exists (
    select 1 from public.organization_members
    where organization_id = v_org
      and user_id = p_driver
      and status = 'active'
      and (expires_at is null or expires_at > now())
      and role = 'driver'
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_driver';
  end if;

  update public.delivery_runs set driver_id = p_driver where id = p_run;
end;
$$;

revoke all on function public.dispatch_assign_driver(uuid, uuid) from public;
grant execute on function public.dispatch_assign_driver(uuid, uuid) to authenticated;

commit;
