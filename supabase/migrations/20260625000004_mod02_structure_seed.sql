-- 20260625000004_mod02_structure_seed.sql
-- MOD-02 seed data for the pilot organization.

begin;

with org as (
  select id from public.organizations where slug = 'ayam-norliza-pilot'
),
profiles as (
  insert into public.production_profiles (organization_id, type, name, workflow_options, status)
  select org.id, profile.type, profile.name, profile.workflow_options::jsonb, 'active'
  from org
  cross join (values
    ('layer', 'Layer standard', '{"eggCollection":true,"bodyWeight":true,"feedWater":true}'::jsonb),
    ('broiler', 'Broiler standard', '{"growthTracking":true,"harvestPlanning":true,"feedWater":true}'::jsonb),
    ('breeder', 'Breeder standard', '{"fertility":true,"hatcheryTransfer":true,"feedWater":true}'::jsonb),
    ('smallholder', 'Smallholder simplified', '{"simpleRounds":true,"simpleInventory":true}'::jsonb)
  ) as profile(type, name, workflow_options)
  on conflict (organization_id, type, name) do nothing
  returning id
),
sets as (
  insert into public.code_sets (organization_id, key, name, description, status)
  select org.id, set_def.key, set_def.name, set_def.description, 'active'
  from org
  cross join (values
    ('breeds', 'Breeds and strains', 'Controlled poultry breed and strain values'),
    ('egg_grades', 'Egg grades', 'Commercial egg grade labels'),
    ('mortality_causes', 'Mortality causes', 'Operational mortality and cull cause codes'),
    ('units', 'Units', 'Display units mapped to canonical units'),
    ('report_categories', 'Report categories', 'Common report grouping labels')
  ) as set_def(key, name, description)
  on conflict (organization_id, key) do nothing
  returning id, organization_id, key
)
insert into public.code_values (organization_id, code_set_id, code, label, sort_order, status)
select sets.organization_id, sets.id, value_def.code, value_def.label, value_def.sort_order, 'active'
from sets
join (values
  ('breeds', 'LOHMANN', 'Lohmann Brown', 10),
  ('breeds', 'ROSS308', 'Ross 308', 20),
  ('egg_grades', 'A', 'Grade A', 10),
  ('egg_grades', 'B', 'Grade B', 20),
  ('egg_grades', 'REJECT', 'Reject', 90),
  ('mortality_causes', 'UNKNOWN', 'Unknown pending review', 10),
  ('mortality_causes', 'CULL', 'Cull', 20),
  ('units', 'BIRD', 'Bird', 10),
  ('units', 'KG', 'Kilogram', 20),
  ('units', 'G', 'Gram', 30),
  ('report_categories', 'OPS', 'Operations', 10),
  ('report_categories', 'QA', 'Quality and biosecurity', 20)
) as value_def(set_key, code, label, sort_order)
  on value_def.set_key = sets.key
on conflict (code_set_id, code) do nothing;

commit;
