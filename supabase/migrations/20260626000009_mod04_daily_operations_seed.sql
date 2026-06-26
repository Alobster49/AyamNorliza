-- 20260626000009_mod04_daily_operations_seed.sql
-- MOD-04 deterministic seed data for the pilot organization.

begin;

with org as (
  select id from public.organizations where slug = 'ayam-norliza-pilot' limit 1
),
owner_member as (
  select m.organization_id, m.user_id
  from public.organization_members m
  join org on org.id = m.organization_id
  where m.status = 'active'
  order by case m.role
    when 'owner' then 1
    when 'org_admin' then 2
    when 'farm_manager' then 3
    else 4
  end
  limit 1
),
template as (
  insert into public.inspection_templates (organization_id, name, description, status)
  select id, 'Default daily husbandry round', 'Baseline daily operations checks for active houses.', 'active'
  from org
  on conflict (organization_id, name) do update
    set status = excluded.status,
        updated_at = now()
  returning id, organization_id
)
insert into public.inspection_template_versions (
  organization_id,
  template_id,
  version,
  production_types,
  risk_classes,
  definition,
  status,
  effective_from,
  approved_by,
  approved_at,
  approval_notes
)
select
  organization_id,
  id,
  '2026.1',
  array['layer','broiler','breeder','smallholder'],
  array['low','medium','high','quarantine'],
  '{
    "sections": [
      {
        "key": "birds",
        "title": "Birds before disturbance",
        "questions": [
          {"key":"bird_behavior","label":"Bird behavior normal","responseType":"boolean","required":true,"critical":true},
          {"key":"mortality_count","label":"Mortality count","responseType":"number","required":true,"critical":true,"unit":"birds","minValue":0}
        ]
      },
      {
        "key": "house",
        "title": "House condition",
        "questions": [
          {"key":"temperature_c","label":"Manual temperature","responseType":"number","required":true,"critical":false,"unit":"C"},
          {"key":"feed_water_available","label":"Feed and water available","responseType":"boolean","required":true,"critical":true},
          {"key":"equipment_state","label":"Equipment state","responseType":"text","required":false,"critical":false}
        ]
      }
    ]
  }'::jsonb,
  case when (select user_id from owner_member) is null then 'draft' else 'approved' end,
  now() - interval '1 day',
  (select user_id from owner_member),
  case when (select user_id from owner_member) is null then null else now() end,
  'Seeded baseline template for MOD-04 vertical slice.'
from template
on conflict (template_id, version) do update
  set definition = excluded.definition,
      production_types = excluded.production_types,
      risk_classes = excluded.risk_classes,
      status = excluded.status,
      effective_from = excluded.effective_from,
      approved_at = excluded.approved_at,
      approval_notes = excluded.approval_notes,
      updated_at = now();

commit;
