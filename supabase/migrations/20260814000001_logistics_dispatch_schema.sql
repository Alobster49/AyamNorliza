-- 20260814000001_logistics_dispatch_schema.sql
-- Dispatch logistics: factory facility + loading bays, postcode ranges per
-- delivery zone, order assignment tracking, and dispatch RPCs. See
-- docs/superpowers/specs/2026-08-13-dispatch-logistics-design.md.

begin;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.assignment_source as enum ('none','auto','manual');

-- ---------------------------------------------------------------------------
-- facilities
-- ---------------------------------------------------------------------------
create table if not exists public.facilities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  address_line text not null check (char_length(address_line) between 1 and 500),
  postcode text not null check (postcode ~ '^[0-9]{5}$'),
  state text not null check (char_length(state) between 1 and 100),
  is_active boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create index if not exists facilities_org_idx on public.facilities(organization_id);

comment on table public.facilities is 'Physical factory/warehouse locations. Single row per org today; multi-facility later is an insert.';

drop trigger if exists facilities_updated_at on public.facilities;
create trigger facilities_updated_at before update on public.facilities
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- bays
-- ---------------------------------------------------------------------------
create table if not exists public.bays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  position integer not null default 0,
  is_active boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create index if not exists bays_org_idx on public.bays(organization_id);
create index if not exists bays_facility_idx on public.bays(facility_id);

comment on table public.bays is 'Physical loading docks at a facility. Trucks park in a bay to load.';

drop trigger if exists bays_updated_at on public.bays;
create trigger bays_updated_at before update on public.bays
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- trucks.bay_id
-- ---------------------------------------------------------------------------
alter table public.trucks add column if not exists bay_id uuid null references public.bays(id) on delete set null;
create index if not exists trucks_bay_idx on public.trucks(bay_id);

-- ---------------------------------------------------------------------------
-- zone_postcode_ranges
-- ---------------------------------------------------------------------------
create table if not exists public.zone_postcode_ranges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  zone_id uuid not null references public.delivery_zones(id) on delete cascade,
  postcode_start text not null check (postcode_start ~ '^[0-9]{5}$'),
  postcode_end text not null check (postcode_end ~ '^[0-9]{5}$'),
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (postcode_end >= postcode_start)
);

create index if not exists zone_postcode_ranges_org_idx on public.zone_postcode_ranges(organization_id);
create index if not exists zone_postcode_ranges_zone_idx on public.zone_postcode_ranges(zone_id);

comment on table public.zone_postcode_ranges is 'Inclusive postcode ranges per delivery zone. Cross-zone overlap allowed; first match by zone name wins.';

-- ---------------------------------------------------------------------------
-- orders.postcode + orders.assignment_source
-- ---------------------------------------------------------------------------
alter table public.orders add column if not exists postcode text null check (postcode is null or postcode ~ '^[0-9]{5}$');
alter table public.orders add column if not exists assignment_source public.assignment_source not null default 'none';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.facilities enable row level security;
alter table public.bays enable row level security;
alter table public.zone_postcode_ranges enable row level security;

-- facilities: org members read; ONLY owner/org_admin write (stricter than managers).
create policy "facilities_select" on public.facilities
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
    )
  );

create policy "facilities_insert" on public.facilities
  for insert to authenticated with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin')
    )
  );

create policy "facilities_update" on public.facilities
  for update to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin')
    )
  );

create policy "facilities_delete" on public.facilities
  for delete to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin')
    )
  );

-- bays: org members read; managers write.
create policy "bays_select" on public.bays
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
    )
  );

create policy "bays_insert" on public.bays
  for insert to authenticated with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "bays_update" on public.bays
  for update to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "bays_delete" on public.bays
  for delete to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin', 'seller')
    )
  );

-- zone_postcode_ranges: org members read; managers insert/delete (no update — replace rows).
create policy "zone_postcode_ranges_select" on public.zone_postcode_ranges
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
    )
  );

create policy "zone_postcode_ranges_insert" on public.zone_postcode_ranges
  for insert to authenticated with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "zone_postcode_ranges_delete" on public.zone_postcode_ranges
  for delete to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin', 'seller')
    )
  );

-- ---------------------------------------------------------------------------
-- dispatch_assign_order: assign a confirmed/ready order to a truck.
-- Upserts the truck+date delivery_runs row (mirrors confirm_order) and
-- moves the order onto it. p_source='auto' never overwrites a manual
-- assignment. Allowed roles include logistics staff.
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_assign_order(p_order uuid, p_truck uuid, p_source public.assignment_source)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_status public.order_status;
  v_date date;
  v_old_run uuid;
  v_old_run_status public.delivery_run_status;
  v_source public.assignment_source;
  v_run uuid;
begin
  if p_source not in ('auto', 'manual') then
    raise exception using errcode = 'P0001', message = 'invalid_source';
  end if;

  select organization_id, status, delivery_date, run_id, assignment_source
  into v_org, v_status, v_date, v_old_run, v_source
  from public.orders where id = p_order for update;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.has_org_role(v_org, array['owner', 'org_admin', 'seller', 'logistics']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_status not in ('confirmed', 'ready') then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  -- Auto never overrides manual.
  if p_source = 'auto' and v_source = 'manual' then
    return;
  end if;

  if v_old_run is not null then
    select status into v_old_run_status from public.delivery_runs where id = v_old_run;
    if v_old_run_status = 'departed' then
      raise exception using errcode = 'P0001', message = 'run_departed';
    end if;
  end if;

  if not exists (
    select 1 from public.trucks
    where id = p_truck and organization_id = v_org and is_active = true
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_truck';
  end if;

  insert into public.delivery_runs (organization_id, truck_id, run_date)
  values (v_org, p_truck, v_date)
  on conflict (truck_id, run_date) do update set truck_id = excluded.truck_id
  returning id into v_run;

  if (select status from public.delivery_runs where id = v_run) = 'departed' then
    raise exception using errcode = 'P0001', message = 'run_departed';
  end if;

  update public.orders
  set truck_id = p_truck, run_id = v_run, assignment_source = p_source
  where id = p_order;
end;
$$;

revoke all on function public.dispatch_assign_order(uuid, uuid, public.assignment_source) from public;
grant execute on function public.dispatch_assign_order(uuid, uuid, public.assignment_source) to authenticated;

-- ---------------------------------------------------------------------------
-- dispatch_unassign_order: send a ticket back to the pool. truck_id stays
-- (column is NOT NULL — it keeps the checkout choice as a default); the
-- board treats assignment_source='none' as "in pool".
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_unassign_order(p_order uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_status public.order_status;
  v_run uuid;
  v_run_status public.delivery_run_status;
begin
  select organization_id, status, run_id into v_org, v_status, v_run
  from public.orders where id = p_order;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.has_org_role(v_org, array['owner', 'org_admin', 'seller', 'logistics']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_status not in ('confirmed', 'ready') then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  if v_run is not null then
    select status into v_run_status from public.delivery_runs where id = v_run;
    if v_run_status = 'departed' then
      raise exception using errcode = 'P0001', message = 'run_departed';
    end if;
  end if;

  update public.orders set assignment_source = 'none' where id = p_order;
end;
$$;

revoke all on function public.dispatch_unassign_order(uuid) from public;
grant execute on function public.dispatch_unassign_order(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- set_run_status: re-create with 'logistics' added to the allowed roles so
-- logistics staff can depart trucks from the dispatch board. Body otherwise
-- identical to 20260810000002.
-- ---------------------------------------------------------------------------
create or replace function public.set_run_status(p_run uuid, p_status public.delivery_run_status)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_current public.delivery_run_status;
begin
  select organization_id, status into v_org, v_current from public.delivery_runs where id = p_run;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'invalid_transition';
  end if;

  if not public.has_org_role(v_org, array['owner', 'org_admin', 'seller', 'logistics']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if not (
    (v_current = 'planned' and p_status = 'departed')
    or (v_current = 'departed' and p_status = 'completed')
    or (v_current = 'planned' and p_status = 'completed')
    -- Idempotent re-fire: confirm_order can still attach a newly-confirmed
    -- order to an already-completed run's delivery_runs row (it upserts on
    -- (truck_id, run_date) with no run-status check), and that order can
    -- later reach 'ready' via complete_order_task. Without this case those
    -- orders are permanently stuck at 'ready' -- completed -> completed
    -- is allowed specifically so the ready -> delivered sweep below can
    -- run again and pick them up.
    or (v_current = 'completed' and p_status = 'completed')
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_transition';
  end if;

  update public.delivery_runs set status = p_status where id = p_run;

  if p_status = 'completed' then
    update public.orders set status = 'delivered' where run_id = p_run and status = 'ready';
  end if;
end;
$$;

revoke all on function public.set_run_status(uuid, public.delivery_run_status) from public;
grant execute on function public.set_run_status(uuid, public.delivery_run_status) to authenticated;

-- ---------------------------------------------------------------------------
-- Default facility row for every existing org (dev convenience; owner can
-- edit in the Factory tab).
-- ---------------------------------------------------------------------------
insert into public.facilities (organization_id, name, address_line, postcode, state)
select id, 'Kilang Ayam', 'Ptd 7904, Batu 31, Kg. Parit Baru, Pontian', '82000', 'Johor'
from public.organizations;

commit;
