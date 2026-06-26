-- supabase/tests/rls/08_flock_lifecycle.sql
-- MOD-03 baseline checks: core flock lifecycle tables have RLS enabled
-- and status-transition helpers exist.

begin;

select plan(10);

select ok(
  (select relrowsecurity from pg_class where relname = 'flocks' and relnamespace = 'public'::regnamespace) = true,
  'flocks has RLS enabled'
);

select ok(
  (select relrowsecurity from pg_class where relname = 'flock_plans' and relnamespace = 'public'::regnamespace) = true,
  'flock_plans has RLS enabled'
);

select ok(
  (select relrowsecurity from pg_class where relname = 'house_readiness_reviews' and relnamespace = 'public'::regnamespace) = true,
  'house_readiness_reviews has RLS enabled'
);

select ok(
  (select relrowsecurity from pg_class where relname = 'placements' and relnamespace = 'public'::regnamespace) = true,
  'placements has RLS enabled'
);

select ok(
  (select relrowsecurity from pg_class where relname = 'flock_movements' and relnamespace = 'public'::regnamespace) = true,
  'flock_movements has RLS enabled'
);

select ok(
  (select relrowsecurity from pg_class where relname = 'flock_count_transactions' and relnamespace = 'public'::regnamespace) = true,
  'flock_count_transactions has RLS enabled'
);

select ok(
  (select relrowsecurity from pg_class where relname = 'harvest_plans' and relnamespace = 'public'::regnamespace) = true,
  'harvest_plans has RLS enabled'
);

select ok(
  (select relrowsecurity from pg_class where relname = 'flock_closeouts' and relnamespace = 'public'::regnamespace) = true,
  'flock_closeouts has RLS enabled'
);

select has_function(
  'public',
  'is_valid_flock_status_transition',
  array['text', 'text'],
  'flock transition helper exists'
);

select has_function(
  'public',
  'check_flock_status_transition',
  array[]::text[],
  'flock transition trigger exists'
);

select * from finish();
rollback;
