-- 20260831000001_role_realignment.sql
--
-- Role realignment: the app now runs on exactly seven roles.
--
--   owner       everything except the data console
--   org_admin   (UI label "Admin") full access, including the data console
--   hr          My Leave + Leave Management
--   seller      products, orders, customers, market prices, dispatch,
--               delivery runs, delivery setup, My Leave
--   supervisor  same permissions as seller
--   inventory   (UI label "Worker") warehouse tasks, loading, My Leave
--   driver      driver deck, My Leave
--
-- Removed roles: farm_manager, caretaker, veterinarian, biosecurity_qa,
-- maintenance, logistics, auditor, support.
--
-- Instead of rewriting every RPC/policy that embeds a role array literal,
-- `has_org_role` itself now resolves role aliases:
--   * org_admin passes every 'owner' gate (full access);
--   * supervisor passes every 'seller' gate;
--   * inventory passes every 'logistics' gate (loading RPCs predate the
--     logistics-role removal and still name it).
-- The reverse is never true: a gate that names only 'org_admin' (the data
-- console pages/actions) does NOT admit the owner.

-- 1) Remap members/invitations on removed roles before tightening checks.
update public.organization_members set role = 'inventory' where role = 'logistics';
update public.organization_members set role = 'supervisor' where role in
  ('farm_manager','caretaker','veterinarian','biosecurity_qa','maintenance','auditor','support');
update public.invitations set role = 'inventory' where role = 'logistics';
update public.invitations set role = 'supervisor' where role in
  ('farm_manager','caretaker','veterinarian','biosecurity_qa','maintenance','auditor','support');
delete from public.role_capability_overrides where role not in
  ('org_admin','hr','seller','supervisor','inventory','driver');

-- 2) Tighten the role checks to the seven remaining roles.
alter table public.organization_members drop constraint if exists organization_members_role_check;
alter table public.organization_members add constraint organization_members_role_check
  check (role in ('owner','org_admin','hr','seller','supervisor','inventory','driver'));

alter table public.invitations drop constraint if exists invitations_role_check;
alter table public.invitations add constraint invitations_role_check
  check (role in ('owner','org_admin','hr','seller','supervisor','inventory','driver'));

alter table public.role_capability_overrides drop constraint if exists role_capability_overrides_role_check;
alter table public.role_capability_overrides add constraint role_capability_overrides_role_check
  check (role in ('org_admin','hr','seller','supervisor','inventory','driver'));

-- 3) Alias-aware has_org_role (same signature; every existing caller keeps
--    working with the new semantics described above).
create or replace function public.has_org_role(target_org uuid, roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = target_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and (m.expires_at is null or m.expires_at > now())
      and (
        m.role = any(roles)
        or (m.role = 'org_admin' and 'owner' = any(roles))
        or (m.role = 'supervisor' and 'seller' = any(roles))
        or (m.role = 'inventory' and 'logistics' = any(roles))
      )
  );
$$;

revoke all on function public.has_org_role(uuid, text[]) from public;
grant execute on function public.has_org_role(uuid, text[]) to authenticated;
