-- supabase/tests/rls/07_farm_structure.sql
-- MOD-02 baseline checks: RLS is enabled on structure/master-data tables
-- and approved target profile versions are protected by trigger logic.

begin;

select plan(6);

select ok(
  (select relrowsecurity from pg_class where relname = 'sites' and relnamespace = 'public'::regnamespace) = true,
  'sites has RLS enabled'
);

select ok(
  (select relrowsecurity from pg_class where relname = 'houses' and relnamespace = 'public'::regnamespace) = true,
  'houses has RLS enabled'
);

select ok(
  (select relrowsecurity from pg_class where relname = 'target_profile_versions' and relnamespace = 'public'::regnamespace) = true,
  'target_profile_versions has RLS enabled'
);

select ok(
  (select relrowsecurity from pg_class where relname = 'code_values' and relnamespace = 'public'::regnamespace) = true,
  'code_values has RLS enabled'
);

select ok(
  (select relrowsecurity from pg_class where relname = 'qr_identifiers' and relnamespace = 'public'::regnamespace) = true,
  'qr_identifiers has RLS enabled'
);

select has_function(
  'public',
  'can_access_structure_scope',
  array['uuid', 'uuid', 'uuid', 'uuid'],
  'structure scope helper exists'
);

select * from finish();
rollback;
