-- 20260625000005_id_access_and_structure_grants.sql
-- Forward-only privilege repair for live projects where earlier RLS
-- migrations were already applied before explicit authenticated grants
-- were added locally. RLS policies still determine row/action access.

begin;

grant usage on schema public to authenticated;

grant select, insert, update, delete on
  public.organizations,
  public.profiles,
  public.organization_members,
  public.member_scopes,
  public.invitations,
  public.access_reviews,
  public.access_review_items,
  public.support_sessions,
  public.break_glass_events
to authenticated;

grant select on
  public.auth_security_events,
  public.audit_log
to authenticated;

commit;
