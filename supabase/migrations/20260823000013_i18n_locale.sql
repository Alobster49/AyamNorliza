-- ---------------------------------------------------------------------------
-- Bilingual UI: per-user language preference.
--
-- `profiles.locale` already existed with only a length check, which would have
-- accepted 'de' or 'xx'. Both tables now enforce the same two-value set so the
-- application never has to defend against a locale it has no catalog for.
-- ---------------------------------------------------------------------------

alter table public.profiles
  drop constraint if exists profiles_locale_check;

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
