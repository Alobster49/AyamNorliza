-- supabase/tests/rls/09_daily_operations.sql
-- MOD-04 baseline checks: daily operations tables have RLS enabled
-- and sync idempotency helpers exist.

begin;

select plan(13);

select ok((select relrowsecurity from pg_class where relname = 'shifts' and relnamespace = 'public'::regnamespace) = true, 'shifts has RLS enabled');
select ok((select relrowsecurity from pg_class where relname = 'shift_assignments' and relnamespace = 'public'::regnamespace) = true, 'shift_assignments has RLS enabled');
select ok((select relrowsecurity from pg_class where relname = 'inspection_templates' and relnamespace = 'public'::regnamespace) = true, 'inspection_templates has RLS enabled');
select ok((select relrowsecurity from pg_class where relname = 'inspection_template_versions' and relnamespace = 'public'::regnamespace) = true, 'inspection_template_versions has RLS enabled');
select ok((select relrowsecurity from pg_class where relname = 'inspections' and relnamespace = 'public'::regnamespace) = true, 'inspections has RLS enabled');
select ok((select relrowsecurity from pg_class where relname = 'inspection_responses' and relnamespace = 'public'::regnamespace) = true, 'inspection_responses has RLS enabled');
select ok((select relrowsecurity from pg_class where relname = 'observations' and relnamespace = 'public'::regnamespace) = true, 'observations has RLS enabled');
select ok((select relrowsecurity from pg_class where relname = 'handovers' and relnamespace = 'public'::regnamespace) = true, 'handovers has RLS enabled');
select ok((select relrowsecurity from pg_class where relname = 'period_closes' and relnamespace = 'public'::regnamespace) = true, 'period_closes has RLS enabled');
select ok((select relrowsecurity from pg_class where relname = 'record_corrections' and relnamespace = 'public'::regnamespace) = true, 'record_corrections has RLS enabled');
select ok((select relrowsecurity from pg_class where relname = 'sync_operations' and relnamespace = 'public'::regnamespace) = true, 'sync_operations has RLS enabled');

select has_function('public', 'is_daily_record_locked', array['text', 'uuid'], 'daily record lock helper exists');
select has_function('public', 'set_sync_operation_processed_at', array[]::text[], 'sync operation trigger helper exists');

select * from finish();
rollback;
