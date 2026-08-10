-- 20260810000003_order_pipeline_seed.sql
-- Pilot org delivery setup + an e2e buyer fixture for Playwright.
-- Idempotent: safe to re-run on every `supabase db reset`.

begin;

-- ---------------------------------------------------------------------------
-- 3 delivery zones
-- ---------------------------------------------------------------------------
insert into public.delivery_zones (id, organization_id, name, display_order, created_by)
select z.id, o.id, z.name, z.display_order, u.id
from (
  values
    ('30000000-0000-0000-0000-000000000001'::uuid, 'Zone 1', 0),
    ('30000000-0000-0000-0000-000000000002'::uuid, 'Zone 2', 1),
    ('30000000-0000-0000-0000-000000000003'::uuid, 'Zone 3', 2)
) as z(id, name, display_order)
cross join (select id from public.organizations where slug = 'ayam-norliza-pilot') as o
cross join (select id from auth.users where email = 'owner@ayam-norliza-pilot.example') as u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2 trucks
-- ---------------------------------------------------------------------------
insert into public.trucks (id, organization_id, name, code, created_by)
select t.id, o.id, t.name, t.code, u.id
from (
  values
    ('30000000-0000-0000-0000-000000000011'::uuid, 'Truck A', 'TRK-A'),
    ('30000000-0000-0000-0000-000000000012'::uuid, 'Truck B', 'TRK-B')
) as t(id, name, code)
cross join (select id from public.organizations where slug = 'ayam-norliza-pilot') as o
cross join (select id from auth.users where email = 'owner@ayam-norliza-pilot.example') as u
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
select o.id, t.truck_id, wd.weekday, tw.start_time, tw.end_time, 10, u.id
from (
  values ('30000000-0000-0000-0000-000000000011'::uuid), ('30000000-0000-0000-0000-000000000012'::uuid)
) as t(truck_id)
cross join (values (1), (2), (3), (4), (5), (6)) as wd(weekday)
cross join (values ('09:00'::time, '12:00'::time), ('14:00'::time, '17:00'::time)) as tw(start_time, end_time)
cross join (select id from public.organizations where slug = 'ayam-norliza-pilot') as o
cross join (select id from auth.users where email = 'owner@ayam-norliza-pilot.example') as u
where not exists (
  select 1 from public.delivery_slots s
  where s.truck_id = t.truck_id and s.weekday = wd.weekday and s.start_time = tw.start_time
);

-- ---------------------------------------------------------------------------
-- E2E buyer fixture: buyer@ayam-norliza-pilot.example, same deterministic
-- password convention as the other local E2E users.
-- Gated on pilot org existence.
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at,
  is_sso_user, is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000',
  '30000000-0000-0000-0000-000000000099',
  'authenticated',
  'authenticated',
  'buyer@ayam-norliza-pilot.example',
  crypt('test-only-password-12-chars', gen_salt('bf')),
  now(), '', '', '', '', '', '', '', '',
  jsonb_build_object('provider', 'email', 'providers', array['email']),
  jsonb_build_object('display_name', 'E2E Pilot Buyer'),
  false, now(), now(), false, false
from (select 1) as _
cross join (select 1 from public.organizations where slug = 'ayam-norliza-pilot') as org_check
on conflict (id) do update
  set email = excluded.email,
      encrypted_password = excluded.encrypted_password,
      email_confirmed_at = excluded.email_confirmed_at,
      updated_at = now();

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(),
  'buyer@ayam-norliza-pilot.example',
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email),
  'email',
  now(), now(), now()
from auth.users u
cross join (select 1 from public.organizations where slug = 'ayam-norliza-pilot') as org_check
where u.email = 'buyer@ayam-norliza-pilot.example'
on conflict (provider, provider_id) do update
  set user_id = excluded.user_id,
      identity_data = excluded.identity_data,
      updated_at = now();

insert into public.buyers (id, organization_id, display_name, phone)
select u.id, o.id, 'E2E Pilot Buyer', '0123456789'
from auth.users u
cross join (select id from public.organizations where slug = 'ayam-norliza-pilot') as o
where u.email = 'buyer@ayam-norliza-pilot.example'
on conflict (id) do update
  set display_name = excluded.display_name,
      phone = excluded.phone,
      updated_at = now();

-- Linked customers row so the buyer already has an order-ready CRM identity.
insert into public.customers (id, organization_id, name, phone, created_by)
select '30000000-0000-0000-0000-0000000000aa', o.id, 'E2E Pilot Buyer', '0123456789', u.id
from auth.users u
cross join (select id from public.organizations where slug = 'ayam-norliza-pilot') as o
where u.email = 'buyer@ayam-norliza-pilot.example'
on conflict (id) do nothing;

update public.buyers
set customer_id = '30000000-0000-0000-0000-0000000000aa'
where id = (select id from auth.users where email = 'buyer@ayam-norliza-pilot.example')
  and customer_id is distinct from '30000000-0000-0000-0000-0000000000aa'::uuid;

commit;
