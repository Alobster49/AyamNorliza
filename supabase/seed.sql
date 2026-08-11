-- supabase/seed.sql
-- Local-only fixtures. Run automatically by `supabase db reset` (see
-- supabase/config.toml [db.seed]) -- NEVER applied by `supabase db push` to a
-- remote/hosted project, so this is the only safe place for a login whose
-- password is committed to the repo.
--
-- Idempotent: safe to re-run on every reset. Gated on the pilot organization
-- already existing (created by 20260624000004_id_access_seed.sql, which runs
-- before this file).
--
-- Accounts created here:
--   owner@ayam-norliza-pilot.example  -- E2E owner (e2e/_fixtures.ts OWNER)
--   target@ayam-norliza-pilot.example -- E2E deactivation target
--   owner@gmail.com                   -- local convenience owner login
-- All three share the deterministic local password below.

begin;

with seed_users as (
  select *
  from (values
    (
      '10000000-0000-0000-0000-000000000001'::uuid,
      'owner@ayam-norliza-pilot.example',
      'Owner Ayam Norliza',
      'owner'
    ),
    (
      '10000000-0000-0000-0000-000000000002'::uuid,
      'target@ayam-norliza-pilot.example',
      'Target User',
      'caretaker'
    ),
    (
      '10000000-0000-0000-0000-000000000003'::uuid,
      'owner@gmail.com',
      'CEO Badrool',
      'owner'
    )
  ) as user_seed(id, email, display_name, role)
  -- Only seed when the pilot org exists, so a partially migrated database
  -- fails loudly on the migration rather than silently here.
  where exists (select 1 from public.organizations where slug = 'ayam-norliza-pilot')
),
inserted_users as (
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
  )
  select
    '00000000-0000-0000-0000-000000000000',
    seed_users.id,
    'authenticated',
    'authenticated',
    seed_users.email,
    extensions.crypt('test-only-password-12-chars', extensions.gen_salt('bf')),
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
    jsonb_build_object('display_name', seed_users.display_name),
    false,
    now(),
    now(),
    false,
    false
  from seed_users
  on conflict (id) do update
    set email = excluded.email,
        encrypted_password = excluded.encrypted_password,
        email_confirmed_at = excluded.email_confirmed_at,
        confirmation_token = excluded.confirmation_token,
        recovery_token = excluded.recovery_token,
        email_change_token_new = excluded.email_change_token_new,
        email_change = excluded.email_change,
        email_change_token_current = excluded.email_change_token_current,
        phone_change = excluded.phone_change,
        phone_change_token = excluded.phone_change_token,
        reauthentication_token = excluded.reauthentication_token,
        raw_app_meta_data = excluded.raw_app_meta_data,
        raw_user_meta_data = excluded.raw_user_meta_data,
        updated_at = now()
  returning id, email
),
inserted_identities as (
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
    inserted_users.email,
    inserted_users.id,
    jsonb_build_object('sub', inserted_users.id::text, 'email', inserted_users.email),
    'email',
    now(),
    now(),
    now()
  from inserted_users
  on conflict (provider, provider_id) do update
    set user_id = excluded.user_id,
        identity_data = excluded.identity_data,
        updated_at = now()
  returning user_id
),
inserted_profiles as (
  insert into public.profiles (user_id, display_name, locale, time_zone, status)
  select seed_users.id, seed_users.display_name, 'en', 'Asia/Kuala_Lumpur', 'active'
  from seed_users
  on conflict (user_id) do update
    set display_name = excluded.display_name,
        locale = excluded.locale,
        time_zone = excluded.time_zone,
        status = excluded.status,
        updated_at = now()
  returning user_id
)
insert into public.organization_members (
  organization_id,
  user_id,
  role,
  status,
  starts_at,
  invited_by
)
select
  organizations.id,
  seed_users.id,
  seed_users.role,
  'active',
  now(),
  '10000000-0000-0000-0000-000000000001'
from seed_users
cross join public.organizations
where organizations.slug = 'ayam-norliza-pilot'
on conflict (organization_id, user_id) do update
  set role = excluded.role,
      status = excluded.status,
      starts_at = excluded.starts_at,
      invited_by = excluded.invited_by,
      updated_at = now();

commit;
