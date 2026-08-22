-- 20260822000003_organizations_anon_grant.sql
-- 20260719000001 added the organizations_select_public RLS policy so the
-- buyer portal can resolve an organization by slug while signed out, but
-- never granted the table privilege — Postgres denies anon at the
-- privilege layer (42501) before RLS is evaluated, so signed-out buyers
-- cannot sign up (buyerSignUpAction's slug lookup fails). Grant matches
-- the delivery_zones anon grant in 20260810000001.

begin;

grant select on public.organizations to anon;

commit;
