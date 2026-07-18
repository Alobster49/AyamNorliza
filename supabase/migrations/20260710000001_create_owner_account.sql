-- Migration: Create owner account for AyamNorliza
-- Run with: supabase db execute --db-url <hosted-db-url> -f create_owner_account.sql

begin;

-- 1. Create the user in auth.users
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  email_change_token_current,
  phone_change,
  phone_change_token,
  reauthentication_token,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  created_at,
  updated_at,
  is_sso_user,
  is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'owner@gmail.com',
  crypt('Ayamnorliza', gen_salt('bf')),
  now(),
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  jsonb_build_object('provider', 'email', 'providers', array['email']),
  jsonb_build_object('display_name', 'CEO Badrool'),
  false,
  now(),
  now(),
  false,
  false
) on conflict (email) do update
  set encrypted_password = crypt('Ayamnorliza', gen_salt('bf')),
      email_confirmed_at = now(),
      updated_at = now();

-- 2. Create identity
insert into auth.identities (
  id,
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  'owner@gmail.com',
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email),
  'email',
  now(),
  now(),
  now()
from auth.users u where u.email = 'owner@gmail.com'
on conflict (provider, provider_id) do update
  set updated_at = now();

-- 3. Create profile
insert into public.profiles (user_id, display_name, locale, time_zone, status)
select u.id, 'CEO Badrool', 'en', 'Asia/Kuala_Lumpur', 'active'
from auth.users u where u.email = 'owner@gmail.com'
on conflict (user_id) do update
  set display_name = 'CEO Badrool',
      updated_at = now();

-- 4. Add to organization as owner
insert into public.organization_members (
  organization_id,
  user_id,
  role,
  status,
  starts_at,
  invited_by
)
select
  o.id,
  u.id,
  'owner',
  'active',
  now(),
  u.id
from auth.users u
cross join public.organizations o
where u.email = 'owner@gmail.com'
  and o.slug = 'ayam-norliza-pilot'
on conflict (organization_id, user_id) do update
  set role = 'owner',
      status = 'active',
      updated_at = now();

commit;
