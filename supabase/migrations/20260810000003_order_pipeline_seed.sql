-- 20260810000003_order_pipeline_seed.sql
-- Pilot org delivery setup (zones/trucks/truck_zones/slots). Idempotent:
-- safe to re-run on every `supabase db reset`.
--
-- The e2e buyer login fixture (auth.users/auth.identities/buyers/customers)
-- used to live in this migration. It has been moved to supabase/seed.sql
-- because migrations are what `supabase db push` replays against a remote
-- project -- shipping a repo-committed-password login as a migration would
-- create that login on the live org the first time this branch is pushed.
-- seed.sql only ever runs locally via `supabase db reset`.

begin;

-- ---------------------------------------------------------------------------
-- 3 delivery zones
-- ---------------------------------------------------------------------------
-- `created_by` is a scalar subquery, not a join: the owner account lives in
-- supabase/seed.sql (local only) and does not exist when migrations run on a
-- fresh or remote database. A join would silently drop every row here and
-- then break the truck_zones FK below; the subquery just yields NULL.
insert into public.delivery_zones (id, organization_id, name, display_order, created_by)
select z.id, o.id, z.name, z.display_order,
  (select id from auth.users where email = 'owner@ayam-norliza-pilot.example')
from (
  values
    ('30000000-0000-0000-0000-000000000001'::uuid, 'Zone 1', 0),
    ('30000000-0000-0000-0000-000000000002'::uuid, 'Zone 2', 1),
    ('30000000-0000-0000-0000-000000000003'::uuid, 'Zone 3', 2)
) as z(id, name, display_order)
cross join (select id from public.organizations where slug = 'ayam-norliza-pilot') as o
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2 trucks
-- ---------------------------------------------------------------------------
insert into public.trucks (id, organization_id, name, code, created_by)
select t.id, o.id, t.name, t.code,
  (select id from auth.users where email = 'owner@ayam-norliza-pilot.example')
from (
  values
    ('30000000-0000-0000-0000-000000000011'::uuid, 'Truck A', 'TRK-A'),
    ('30000000-0000-0000-0000-000000000012'::uuid, 'Truck B', 'TRK-B')
) as t(id, name, code)
cross join (select id from public.organizations where slug = 'ayam-norliza-pilot') as o
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Truck coverage: TRK-A -> Zone 1 + Zone 2; TRK-B -> Zone 3
-- ---------------------------------------------------------------------------
insert into public.truck_zones (truck_id, zone_id, organization_id)
select tz.truck_id, tz.zone_id, o.id
from (
  values
    ('30000000-0000-0000-0000-000000000011'::uuid, '30000000-0000-0000-0000-000000000001'::uuid),
    ('30000000-0000-0000-0000-000000000011'::uuid, '30000000-0000-0000-0000-000000000002'::uuid),
    ('30000000-0000-0000-0000-000000000012'::uuid, '30000000-0000-0000-0000-000000000003'::uuid)
) as tz(truck_id, zone_id)
cross join (select id from public.organizations where slug = 'ayam-norliza-pilot') as o
on conflict (truck_id, zone_id) do nothing;

-- ---------------------------------------------------------------------------
-- Slots: Mon-Sat (weekday 1-6, JS Date.getDay convention), 09:00-12:00 and
-- 14:00-17:00, both trucks, max_orders 10. No unique constraint on
-- (truck_id, weekday, start_time) exists, so idempotency is a NOT EXISTS
-- guard rather than ON CONFLICT.
-- ---------------------------------------------------------------------------
insert into public.delivery_slots (organization_id, truck_id, weekday, start_time, end_time, max_orders, created_by)
select o.id, t.truck_id, wd.weekday, tw.start_time, tw.end_time, 10,
  (select id from auth.users where email = 'owner@ayam-norliza-pilot.example')
from (
  values ('30000000-0000-0000-0000-000000000011'::uuid), ('30000000-0000-0000-0000-000000000012'::uuid)
) as t(truck_id)
cross join (values (1), (2), (3), (4), (5), (6)) as wd(weekday)
cross join (values ('09:00'::time, '12:00'::time), ('14:00'::time, '17:00'::time)) as tw(start_time, end_time)
cross join (select id from public.organizations where slug = 'ayam-norliza-pilot') as o
where not exists (
  select 1 from public.delivery_slots s
  where s.truck_id = t.truck_id and s.weekday = wd.weekday and s.start_time = tw.start_time
);

commit;
