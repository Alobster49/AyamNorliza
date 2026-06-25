-- 20260624000004_id_access_seed.sql
-- MOD-01 seed: one pilot organization, controlled-vocabulary code_set
-- entries for the role set so the UI selects have something to render.

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
