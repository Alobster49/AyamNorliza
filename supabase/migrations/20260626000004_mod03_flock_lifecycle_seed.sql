-- 20260626000004_mod03_flock_lifecycle_seed.sql
-- MOD-03 controlled vocabulary seed data for flock lifecycle.

begin;

with org as (
  select id from public.organizations where slug = 'ayam-norliza-pilot'
),
sets as (
  insert into public.code_sets (organization_id, key, name, description, status)
  select org.id, set_def.key, set_def.name, set_def.description, 'active'
  from org
  cross join (values
    ('flock_sources', 'Flock sources', 'Approved hatchery, supplier and internal source labels'),
    ('flock_movement_reasons', 'Flock movement reasons', 'Controlled reasons for flock transfer, split, merge and removal'),
    ('readiness_checklist', 'Readiness checklist', 'Default house-readiness checklist items')
  ) as set_def(key, name, description)
  on conflict (organization_id, key) do nothing
  returning id, organization_id, key
)
insert into public.code_values (organization_id, code_set_id, code, label, sort_order, status)
select sets.organization_id, sets.id, value_def.code, value_def.label, value_def.sort_order, 'active'
from sets
join (values
  ('flock_sources', 'JOHOR_HATCHERY', 'Johor Hatchery', 10),
  ('flock_sources', 'INTERNAL_TRANSFER', 'Internal transfer', 20),
  ('flock_movement_reasons', 'CAPACITY_BALANCE', 'Capacity balancing', 10),
  ('flock_movement_reasons', 'HEALTH_SEGREGATION', 'Health segregation', 20),
  ('flock_movement_reasons', 'HARVEST_REMOVAL', 'Harvest removal', 30),
  ('readiness_checklist', 'SANITATION', 'Sanitation release complete', 10),
  ('readiness_checklist', 'MAINTENANCE', 'Critical maintenance complete', 20),
  ('readiness_checklist', 'CALIBRATION', 'Calibration checks complete', 30),
  ('readiness_checklist', 'SUPPLIES', 'Feed, water and supplies ready', 40),
  ('readiness_checklist', 'ENVIRONMENT', 'Environment stabilized', 50)
) as value_def(set_key, code, label, sort_order)
  on value_def.set_key = sets.key
on conflict (code_set_id, code) do nothing;

commit;
