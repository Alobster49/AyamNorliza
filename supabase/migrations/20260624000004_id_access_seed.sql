-- 20260624000004_id_access_seed.sql
-- MOD-01 seed: one pilot organization so the UI selects have something to
-- render.
--
-- The E2E login fixtures that used to live here (owner@ / target@
-- ayam-norliza-pilot.example, with a repo-committed password) were moved to
-- supabase/seed.sql: `supabase db reset` runs that file, `supabase db push`
-- does not, so no login with a committed password can reach a hosted project.
-- Rule: auth fixtures belong in supabase/seed.sql. Never in a migration.

begin;

insert into public.organizations (slug, name, legal_name, region, default_time_zone, default_locale, status)
values (
  'ayam-norliza-pilot',
  'AyamNorliza Pilot',
  'AyamNorliza Sdn Bhd',
  'MY',
  'Asia/Kuala_Lumpur',
  'en',
  'active'
)
on conflict (slug) do nothing;

commit;
