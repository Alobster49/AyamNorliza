-- ---------------------------------------------------------------------------
-- Bilingual UI: per-user language preference.
--
-- `profiles.locale` already existed with only a length check, which would have
-- accepted 'de' or 'xx'. Both tables now enforce the same two-value set so the
-- application never has to defend against a locale it has no catalog for.
-- ---------------------------------------------------------------------------

alter table public.profiles
  drop constraint if exists profiles_locale_check;

-- The old check only enforced a length (2-10 chars), so a production row can
-- legally hold something like 'en-US' or 'ms-MY' today. Normalize before the
-- stricter constraint goes on, or the ALTER TABLE below aborts mid-deploy on
-- that row. Match on a 'ms' prefix rather than collapsing everything to
-- 'en' - the column's only writer to date has been its own 'en' default, so
-- no row is expected to actually hit this, but a hypothetical 'ms-MY' should
-- normalize to 'ms', not silently flip a Malay-speaking user to English.
update public.profiles
  set locale = case when locale like 'ms%' then 'ms' else 'en' end
  where locale not in ('en', 'ms');

alter table public.profiles
  add constraint profiles_locale_check
  check (locale in ('en', 'ms'));

alter table public.buyers
  add column if not exists locale text not null default 'en';

alter table public.buyers
  drop constraint if exists buyers_locale_check;

alter table public.buyers
  add constraint buyers_locale_check
  check (locale in ('en', 'ms'));

comment on column public.buyers.locale is
  'UI language for this buyer: en or ms. Also selects the language of transactional email.';

-- Grants on the new column. A new column on an existing table does not inherit
-- column-level grants where they were issued per column.
grant select, update (locale) on public.buyers to authenticated;
