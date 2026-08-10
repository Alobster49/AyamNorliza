-- supabase/seed.sql
-- Local-only fixtures. Run automatically by `supabase db reset` (see
-- supabase/config.toml [db.seed]) -- NEVER applied by `supabase db push` to
-- a remote/hosted project, so it is the only safe place for a login with a
-- repo-committed password.
--
-- Idempotent: safe to re-run on every reset. Gated on the pilot org already
-- existing (created by the migrations that run before this file).

begin;

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
