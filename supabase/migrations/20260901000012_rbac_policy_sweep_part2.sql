-- Task 13, part 3: the last policies that still name a role.
--
-- 20260901000006 swept the resource tables. Thirteen policies were held back
-- because they change who can *read* core data, and getting them wrong breaks
-- working screens rather than merely refusing a write. They fall into two
-- groups, handled differently.
--
-- ## The operational reads
--
-- `orders`, `order_items`, `delivery_runs`, `delivery_attempts`,
-- `run_stop_events` and the delivery-POD bucket all read "any active member
-- except a driver". That is not one grant. The naive translation --
-- `has_permission(org,'orders','view')` -- breaks the loading board: it is
-- worked by Workers (stored role `inventory`), `getDispatchBoard` admits them
-- on `loading:edit`, and it reads `orders` and `delivery_runs`, while a Worker
-- holds no `orders` grant at all. Traced through the callers before writing
-- this, rather than assumed.
--
-- So the predicate becomes "holds any operational read", via
-- `has_ops_read()`: orders, dispatch, loading, warehouse_tasks or
-- delivery_runs. Against the seeded roles that admits owner, org_admin,
-- seller, supervisor and inventory, and excludes driver exactly as
-- `role <> 'driver'` did.
--
-- One deliberate tightening: `hr` loses these reads. It held them only
-- because it is not the literal string 'driver'; HR holds nothing but the
-- leave resources and has no business reading the order book. A custom role
-- with equivalent grants is now admitted on its grants rather than refused
-- for having the wrong name, which was the whole point of dynamic RBAC.
--
-- ## The admin tables
--
-- `audit_log`, `auth_security_events`, `break_glass_events`,
-- `support_sessions` and `profiles` hardcode owner/org_admin. Each maps onto
-- an admin capability that already exists in ADMIN_CAPABILITIES and, until
-- now, had no consumer -- granting `audit.read` through the roles editor did
-- nothing at all. Now it does.
--
-- `break_glass_update_end` also carried `with check (true)`: the USING clause
-- correctly limited *which row* you could touch, then the check allowed
-- rewriting *any column* of it, including `user_id`, `organization_id` and
-- `reason`, on a security audit record. RLS cannot compare against the old
-- row, so the immutability is enforced by a trigger instead.
--
-- `organizations_insert_owner` is deliberately left alone: the caller has no
-- membership yet when creating an organization, so there is no grant to check.

begin;

-- ---------------------------------------------------------------------------
-- 1. "Holds some operational read" -- the grant-shaped replacement for
--    `role <> 'driver'`.
-- ---------------------------------------------------------------------------
create or replace function public.has_ops_read(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.has_permission(target_org, 'orders', 'view')
    or public.has_permission(target_org, 'dispatch', 'view')
    or public.has_permission(target_org, 'loading', 'view')
    or public.has_permission(target_org, 'warehouse_tasks', 'view')
    or public.has_permission(target_org, 'delivery_runs', 'view');
$$;

revoke all on function public.has_ops_read(uuid) from public, anon;
grant execute on function public.has_ops_read(uuid) to authenticated;

comment on function public.has_ops_read(uuid) is
  'True for a member holding any operational read grant (orders, dispatch, loading, warehouse_tasks, delivery_runs). Replaces the hardcoded role <> ''driver'' on the operational tables: drivers read their own run through their own policies, and several screens (notably the loading board, worked by Workers) read orders without holding an orders grant.';

drop policy if exists orders_select_member on public.orders;
create policy orders_select_member on public.orders for select to authenticated
  using (public.has_ops_read(organization_id));

drop policy if exists order_items_select_member on public.order_items;
create policy order_items_select_member on public.order_items for select to authenticated
  using (
    order_id in (select o.id from public.orders o where public.has_ops_read(o.organization_id))
  );

drop policy if exists delivery_runs_select on public.delivery_runs;
create policy delivery_runs_select on public.delivery_runs for select to authenticated
  using (public.has_ops_read(organization_id));

drop policy if exists delivery_attempts_select_member on public.delivery_attempts;
create policy delivery_attempts_select_member on public.delivery_attempts for select to authenticated
  using (public.has_ops_read(organization_id));

drop policy if exists run_stop_events_select_member on public.run_stop_events;
create policy run_stop_events_select_member on public.run_stop_events for select to authenticated
  using (public.has_ops_read(organization_id));

drop policy if exists delivery_pod_member_read on storage.objects;
create policy delivery_pod_member_read on storage.objects for select to authenticated
  using (
    bucket_id = 'delivery-pod'
    and (storage.foldername(name))[1] in (
      select m.organization_id::text from public.organization_members m
       where m.user_id = (select auth.uid())
         and public.has_ops_read(m.organization_id))
  );

-- ---------------------------------------------------------------------------
-- 2. Admin tables -> the capabilities that already existed for them.
--
-- Both `audit.read` and `audit_log.read` are seeded capabilities covering the
-- same screen, so either is accepted rather than silently making one of them
-- meaningless again.
-- ---------------------------------------------------------------------------
drop policy if exists audit_log_select_admin on public.audit_log;
create policy audit_log_select_admin on public.audit_log for select to authenticated
  using (
    case
      when audit_log.organization_id is not null then
        public.has_permission(audit_log.organization_id, 'audit_log.read', 'use')
        or public.has_permission(audit_log.organization_id, 'audit.read', 'use')
      else
        -- Org-less rows (platform events) are visible to anyone holding the
        -- capability anywhere, matching the previous behaviour.
        exists (
          select 1 from public.organization_members m
          where m.user_id = (select auth.uid()) and m.status = 'active'
            and (public.has_permission(m.organization_id, 'audit_log.read', 'use')
                 or public.has_permission(m.organization_id, 'audit.read', 'use'))
        )
    end
  );

drop policy if exists auth_security_events_select_admin on public.auth_security_events;
create policy auth_security_events_select_admin on public.auth_security_events for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.organization_members m
      where m.user_id = (select auth.uid()) and m.status = 'active'
        and public.has_permission(m.organization_id, 'auth_security.read', 'use')
    )
  );

drop policy if exists break_glass_insert_self_or_owner on public.break_glass_events;
create policy break_glass_insert_self_or_owner on public.break_glass_events for insert to authenticated
  with check (
    (
      user_id = (select auth.uid())
      and (
        approved_by is null
        or approved_by = user_id
        or public.has_permission(break_glass_events.organization_id, 'break_glass.finalize', 'use')
      )
    )
    or public.has_permission(break_glass_events.organization_id, 'break_glass.open', 'use')
  );

drop policy if exists break_glass_update_end on public.break_glass_events;
create policy break_glass_update_end on public.break_glass_events for update to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_permission(organization_id, 'break_glass.finalize', 'use')
  )
  with check (
    user_id = (select auth.uid())
    or public.has_permission(organization_id, 'break_glass.finalize', 'use')
  );

-- RLS cannot see the old row, so column immutability needs a trigger. Closing
-- out or reviewing an event is the only legitimate update; the identity of the
-- event is evidence and must not be rewritten after the fact.
create or replace function public.protect_break_glass_identity() returns trigger
language plpgsql as $$
begin
  if new.user_id is distinct from old.user_id
     or new.organization_id is distinct from old.organization_id
     or new.reason is distinct from old.reason
     or new.starts_at is distinct from old.starts_at
     or new.expires_at is distinct from old.expires_at then
    raise exception using errcode = 'P0001', message = 'break_glass_immutable';
  end if;
  return new;
end $$;

drop trigger if exists break_glass_protect_identity on public.break_glass_events;
create trigger break_glass_protect_identity before update on public.break_glass_events
  for each row execute function public.protect_break_glass_identity();

drop policy if exists profiles_admin_status_update on public.profiles;
create policy profiles_admin_status_update on public.profiles for update to authenticated
  using (
    exists (
      select 1 from public.organization_members m
      where m.user_id = (select auth.uid()) and m.status = 'active'
        and public.has_permission(m.organization_id, 'membership.deactivate', 'use')
    )
  )
  with check (
    exists (
      select 1 from public.organization_members m
      where m.user_id = (select auth.uid()) and m.status = 'active'
        and public.has_permission(m.organization_id, 'membership.deactivate', 'use')
    )
  );

drop policy if exists support_sessions_admin_write on public.support_sessions;
create policy support_sessions_admin_write on public.support_sessions for all to authenticated
  using (public.has_permission(organization_id, 'organization.manage', 'use'))
  with check (public.has_permission(organization_id, 'organization.manage', 'use'));

commit;
