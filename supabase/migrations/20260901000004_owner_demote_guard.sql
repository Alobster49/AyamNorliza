-- 20260901000004_owner_demote_guard.sql
--
-- Merge-blocker fix (final whole-branch review, Important): the current
-- `org_members_update_admin` policy on public.organization_members gates its
-- USING clause on `has_permission(org, 'membership.role.change', 'use')`
-- alone -- it never inspects the rank of the row being touched. Its WITH
-- CHECK clause (last redefined in 20260901000003_dynamic_rbac_role_hardening.sql)
-- does rank-check the *new* role being written, but USING runs against the
-- *existing* row before WITH CHECK ever sees it, so an org_admin (rank 80)
-- can target and rewrite an owner's (rank 100) membership row -- changing
-- role_id, status, expires_at, whatever -- entirely bypassing the app's
-- two-person owner-approval flow for demoting/removing an owner.
--
-- Fix: add the same rank predicate used in WITH CHECK to USING, but applied
-- to the row's CURRENT role/org (organization_members.organization_id,
-- organization_members.role) rather than the incoming new role. In an UPDATE
-- policy, USING is evaluated against the existing row, so this rejects any
-- attempt to touch a row whose current rank exceeds the caller's rank --
-- closing the owner-lockout path -- while leaving every other capability
-- gate (has_permission) and the existing WITH CHECK untouched.
--
-- The policy body below is otherwise byte-for-byte the current live
-- definition (superseded by 20260901000003_dynamic_rbac_role_hardening.sql,
-- confirmed via grep -- 000002's own copy of this policy is stale and was
-- already replaced): only the added `and ...` line in USING is new.
--
-- organization_members.role (text) is the right column to rank against:
-- it is the legacy role-key column, kept in sync with role_id by the
-- `sync_member_role_columns` trigger (20260901000001), and org_role_rank
-- looks rows up by `r.key = role_key` in organization_roles -- role holds
-- exactly that key text.

begin;

drop policy if exists org_members_update_admin on public.organization_members;
create policy org_members_update_admin
  on public.organization_members for update to authenticated
  using (
    public.has_permission(organization_id, 'membership.role.change', 'use')
    and public.org_role_rank(organization_members.organization_id, organization_members.role)
        <= public.caller_role_rank(organization_members.organization_id)
  )
  with check (
    public.has_permission(organization_id, 'membership.role.change', 'use')
    and public.org_role_rank(organization_id, role) <= public.caller_role_rank(organization_id)
  );

commit;
