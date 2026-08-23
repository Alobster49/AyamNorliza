-- supabase/tests/rls/22_anon_zone_slot_lookup.sql
-- Terus Segar wall-free checkout (2026-08-23): anon can execute the two
-- read-only zone/slot lookups (get_delivery_options,
-- resolve_zone_for_postcode) but still cannot execute place_order, which
-- stays authenticated-only.

begin;
select plan(3);

select ok(
  has_function_privilege('anon', 'public.resolve_zone_for_postcode(uuid, text)', 'execute'),
  'anon can execute resolve_zone_for_postcode'
);
select ok(
  has_function_privilege('anon', 'public.get_delivery_options(uuid, uuid)', 'execute'),
  'anon can execute get_delivery_options'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.place_order(uuid, uuid, uuid, date, text, text, jsonb, uuid, text)',
    'execute'
  ),
  'anon cannot execute place_order'
);

select * from finish();
rollback;
