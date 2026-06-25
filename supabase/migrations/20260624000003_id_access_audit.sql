-- 20260624000003_id_access_audit.sql
-- Triggers: updated_at maintenance, audit_log immutability,
-- invitations field freeze, and role-transition validation.

begin;

-- ---------------------------------------------------------------------------
-- Generic updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'organizations',
      'profiles',
      'organization_members',
      'access_reviews'
    ])
  loop
    execute format(
      'drop trigger if exists %I_set_updated_at on public.%I;
       create trigger %I_set_updated_at
         before update on public.%I
         for each row execute function public.set_updated_at();',
      t, t, t, t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- audit_log immutability: deny UPDATE and DELETE for any role.
-- ---------------------------------------------------------------------------
create or replace function public.deny_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only; % is not permitted', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists audit_log_no_update on public.audit_log;
create trigger audit_log_no_update
  before update on public.audit_log
  for each row execute function public.deny_audit_mutation();

drop trigger if exists audit_log_no_delete on public.audit_log;
create trigger audit_log_no_delete
  before delete on public.audit_log
  for each row execute function public.deny_audit_mutation();

-- ---------------------------------------------------------------------------
-- organization_members: validate status transitions and prevent owner
-- removal that would leave the org without one.
-- ---------------------------------------------------------------------------
create or replace function public.check_org_member_transition()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'UPDATE') then
    if old.status = 'active' and new.status in ('invited') then
      raise exception 'cannot revert an active member to invited'
        using errcode = 'check_violation';
    end if;
  end if;

  if (tg_op = 'DELETE') then
    if old.role = 'owner' and old.status = 'active' then
      raise exception 'cannot delete an active owner; transfer ownership first'
        using errcode = 'check_violation';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists organization_members_transition on public.organization_members;
create trigger organization_members_transition
  before update or delete on public.organization_members
  for each row execute function public.check_org_member_transition();

-- ---------------------------------------------------------------------------
-- invitations: only `revoked_at` may change after creation.
-- ---------------------------------------------------------------------------
create or replace function public.freeze_invitation_fields()
returns trigger
language plpgsql
as $$
begin
  if new.email          <> old.email          then raise exception 'invitation.email is immutable'     using errcode = 'check_violation'; end if;
  if new.role           <> old.role           then raise exception 'invitation.role is immutable'      using errcode = 'check_violation'; end if;
  if new.proposed_scopes::text <> old.proposed_scopes::text then raise exception 'invitation.proposed_scopes is immutable' using errcode = 'check_violation'; end if;
  if new.token_hash     <> old.token_hash     then raise exception 'invitation.token_hash is immutable' using errcode = 'check_violation'; end if;
  if new.invited_by     <> old.invited_by     then raise exception 'invitation.invited_by is immutable' using errcode = 'check_violation'; end if;
  if new.expires_at     <> old.expires_at     then raise exception 'invitation.expires_at is immutable' using errcode = 'check_violation'; end if;
  if new.organization_id <> old.organization_id then raise exception 'invitation.organization_id is immutable' using errcode = 'check_violation'; end if;
  return new;
end;
$$;

drop trigger if exists invitations_freeze on public.invitations;
create trigger invitations_freeze
  before update on public.invitations
  for each row execute function public.freeze_invitation_fields();

commit;
