-- supabase/tests/rls/30_ops_reads_and_admin_tables.sql
-- Coverage for 20260901000012_rbac_policy_sweep_part2.sql.
--
-- The regression this guards against is specific: the loading board is worked
-- by Workers (stored role `inventory`), `getDispatchBoard` admits them on
-- `loading:edit`, and it reads `orders` and `delivery_runs` -- while a Worker
-- holds no `orders` grant whatsoever. Translating `role <> 'driver'` into
-- `has_permission(org,'orders','view')` would have looked correct and broken
-- that screen. Test 1 is the one that would have caught it.

begin;

select plan(9);

insert into public.organizations (id, slug, name)
values ('ea000000-0000-0000-0000-00000000000a', 'ops-reads-test-org', 'Ops Reads Org')
on conflict (id) do nothing;

insert into auth.users (id)
values
  ('ea000000-0000-0000-0000-000000000001'),  -- org_admin
  ('ea000000-0000-0000-0000-000000000002'),  -- inventory (Worker, loading board)
  ('ea000000-0000-0000-0000-000000000003'),  -- hr
  ('ea000000-0000-0000-0000-000000000004')   -- driver
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, role, status)
values
  ('ea000000-0000-0000-0000-00000000000a', 'ea000000-0000-0000-0000-000000000001', 'org_admin', 'active'),
  ('ea000000-0000-0000-0000-00000000000a', 'ea000000-0000-0000-0000-000000000002', 'inventory', 'active'),
  ('ea000000-0000-0000-0000-00000000000a', 'ea000000-0000-0000-0000-000000000003', 'hr', 'active'),
  ('ea000000-0000-0000-0000-00000000000a', 'ea000000-0000-0000-0000-000000000004', 'driver', 'active')
on conflict (organization_id, user_id) do nothing;

insert into public.customers (id, organization_id, name, phone, created_by)
values ('ea000000-0000-0000-0000-0000000000c1', 'ea000000-0000-0000-0000-00000000000a',
        'Warung Ops', '0123456789', 'ea000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.delivery_zones (id, organization_id, name, is_active)
values ('ea000000-0000-0000-0000-0000000000d1', 'ea000000-0000-0000-0000-00000000000a', 'Zone Ops', true)
on conflict (id) do nothing;


insert into public.trucks (id, organization_id, code, name, is_active)
values ('ea000000-0000-0000-0000-0000000000d3', 'ea000000-0000-0000-0000-00000000000a',
        'OPS-1', 'Ops Truck', true)
on conflict (id) do nothing;

insert into public.delivery_slots (id, organization_id, truck_id, weekday, start_time, end_time, is_active)
values ('ea000000-0000-0000-0000-0000000000d2', 'ea000000-0000-0000-0000-00000000000a',
        'ea000000-0000-0000-0000-0000000000d3', 1, '08:00', '12:00', true)
on conflict (id) do nothing;

insert into public.orders (
  id, organization_id, customer_id, created_by, source, status,
  zone_id, delivery_address, delivery_date, slot_id, truck_id, assignment_source, total_amount
) values (
  'ea000000-0000-0000-0000-0000000000b1', 'ea000000-0000-0000-0000-00000000000a',
  'ea000000-0000-0000-0000-0000000000c1', 'ea000000-0000-0000-0000-000000000001',
  'manual', 'confirmed', 'ea000000-0000-0000-0000-0000000000d1', '1 Jalan Ops',
  current_date + 1, 'ea000000-0000-0000-0000-0000000000d2', 'ea000000-0000-0000-0000-0000000000d3',
  'none', 0
) on conflict (id) do nothing;

insert into public.audit_log (organization_id, actor_user_id, event_type, entity_type, source)
values ('ea000000-0000-0000-0000-00000000000a', 'ea000000-0000-0000-0000-000000000001', 'test.event', 'order', 'server')
on conflict do nothing;

create or replace function pg_temp.impersonate(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1-2: the loading-board case. A Worker holds loading + warehouse_tasks and
--      no orders grant, but the board they work reads orders and runs.
-- ---------------------------------------------------------------------------
select pg_temp.impersonate('ea000000-0000-0000-0000-000000000002');

select is(
  (select count(*) from public.orders where organization_id = 'ea000000-0000-0000-0000-00000000000a'),
  1::bigint,
  'a Worker can still read orders -- the loading board depends on it');

select ok(
  not public.has_permission('ea000000-0000-0000-0000-00000000000a', 'orders', 'view'),
  'and does so without holding orders:view, which is why the naive rewrite would have broken it');

-- ---------------------------------------------------------------------------
-- 3-4: office staff keep the read; HR loses it.
-- ---------------------------------------------------------------------------
select pg_temp.impersonate('ea000000-0000-0000-0000-000000000001');
select is(
  (select count(*) from public.orders where organization_id = 'ea000000-0000-0000-0000-00000000000a'),
  1::bigint,
  'an admin reads orders');

select pg_temp.impersonate('ea000000-0000-0000-0000-000000000003');
select is(
  (select count(*) from public.orders where organization_id = 'ea000000-0000-0000-0000-00000000000a'),
  0::bigint,
  'HR cannot read the order book -- it holds only the leave resources');

-- ---------------------------------------------------------------------------
-- 5: a driver is excluded from the office-wide read, exactly as the old
--    role <> 'driver' clause did. Their own run stays reachable through the
--    driver-scoped policies, which this migration does not touch.
-- ---------------------------------------------------------------------------
select pg_temp.impersonate('ea000000-0000-0000-0000-000000000004');
select is(
  (select count(*) from public.orders where organization_id = 'ea000000-0000-0000-0000-00000000000a'),
  0::bigint,
  'a driver gets no office-wide order read');

-- ---------------------------------------------------------------------------
-- 6-7: the audit capability finally has an effect. Until now audit_log
--      hardcoded owner/org_admin, so granting audit.read did nothing.
-- ---------------------------------------------------------------------------
select pg_temp.impersonate('ea000000-0000-0000-0000-000000000001');
select ok(
  (select count(*) from public.audit_log where organization_id = 'ea000000-0000-0000-0000-00000000000a') > 0,
  'an admin reads the audit log');

select pg_temp.impersonate('ea000000-0000-0000-0000-000000000003');
select is(
  (select count(*) from public.audit_log where organization_id = 'ea000000-0000-0000-0000-00000000000a'),
  0::bigint,
  'a role without the audit capability does not');

-- ---------------------------------------------------------------------------
-- 8-9: a break-glass record is evidence. Closing one out is allowed; rewriting
--      whose it was is not, which `with check (true)` used to permit.
-- ---------------------------------------------------------------------------
select set_config('role', 'postgres', true);
insert into public.break_glass_events (id, organization_id, user_id, reason, expires_at)
values ('ea000000-0000-0000-0000-0000000000e1', 'ea000000-0000-0000-0000-00000000000a',
        'ea000000-0000-0000-0000-000000000001', 'incident 42', now() + interval '1 hour')
on conflict (id) do nothing;

select pg_temp.impersonate('ea000000-0000-0000-0000-000000000001');

select lives_ok(
  $$ update public.break_glass_events set ended_at = now()
      where id = 'ea000000-0000-0000-0000-0000000000e1' $$,
  'the holder can close out their own break-glass event');

select throws_ok(
  $$ update public.break_glass_events set reason = 'rewritten after the fact'
      where id = 'ea000000-0000-0000-0000-0000000000e1' $$,
  'P0001',
  'break_glass_immutable',
  'but cannot rewrite the record of what it was for');

select * from finish();
rollback;
