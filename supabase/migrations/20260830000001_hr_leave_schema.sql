-- HR leave module: schema, RLS, seeds.
-- New role 'hr' approves leave together with owner/org_admin.
-- Engine rules (mirrored by src/features/hr/lib/leave-model.ts):
-- pro-rata accrual by month, workday counting minus public_holidays,
-- carry-forward-first deduction, CF expires 31 Oct, credits expire 31 Dec.

begin;

-- 1. hr role -----------------------------------------------------------------
alter table public.organization_members drop constraint if exists organization_members_role_check;
alter table public.organization_members add constraint organization_members_role_check
  check (role in (
    'owner','org_admin','hr','seller','farm_manager','supervisor','caretaker',
    'veterinarian','biosecurity_qa','maintenance','inventory',
    'logistics','auditor','support','driver'
  ));

alter table public.invitations drop constraint if exists invitations_role_check;
alter table public.invitations add constraint invitations_role_check
  check (role in (
    'owner','org_admin','hr','seller','farm_manager','supervisor','caretaker',
    'veterinarian','biosecurity_qa','maintenance','inventory',
    'logistics','auditor','support','driver'
  ));

alter table public.role_capability_overrides drop constraint if exists role_capability_overrides_role_check;
alter table public.role_capability_overrides add constraint role_capability_overrides_role_check
  check (role in (
    'owner','org_admin','hr','seller','farm_manager','supervisor','caretaker',
    'veterinarian','biosecurity_qa','maintenance','inventory',
    'logistics','auditor','support','driver'
  ));

-- 2. Tables ------------------------------------------------------------------
create table if not exists public.leave_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  code text not null,
  name text not null,
  entitlement_days numeric(5,2),          -- NULL = upon-request (no balance)
  accrual text not null default 'full' check (accrual in ('pro_rata','full')),
  carry_forward_cap numeric(5,2),         -- NULL = no carry-forward
  requires_attachment boolean not null default false,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table if not exists public.leave_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  leave_type_id uuid not null references public.leave_types (id) on delete cascade,
  year integer not null,
  kind text not null check (kind in ('carry_forward','credit','adjustment')),
  days numeric(5,2) not null,
  expires_on date,
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists leave_ledger_user_idx
  on public.leave_ledger (organization_id, user_id, leave_type_id, year);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  leave_type_id uuid not null references public.leave_types (id) on delete cascade,
  year integer not null,
  start_date date not null,
  end_date date not null,
  day_count numeric(5,2) not null check (day_count > 0),
  justification text not null,
  attachment_path text,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','cancelled')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  breakdown jsonb,                        -- {"carry_forward_used": n, "base_used": n} at approval
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists leave_requests_user_idx
  on public.leave_requests (organization_id, user_id, year);
create index if not exists leave_requests_status_idx
  on public.leave_requests (organization_id, status);

create table if not exists public.leave_credit_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  leave_type_id uuid not null references public.leave_types (id) on delete cascade,
  credit_type text not null default 'replacement' check (credit_type in ('replacement')),
  amount numeric(5,2) not null check (amount > 0),
  reference_start date not null,
  reference_end date not null,
  justification text,
  attachment_path text,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','cancelled')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  check (reference_end >= reference_start)
);

create table if not exists public.public_holidays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  holiday_date date not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, holiday_date, name)
);

-- 3. RLS ---------------------------------------------------------------------
alter table public.leave_types enable row level security;
alter table public.leave_ledger enable row level security;
alter table public.leave_requests enable row level security;
alter table public.leave_credit_requests enable row level security;
alter table public.public_holidays enable row level security;

-- any active member of the org may read reference data
create policy "leave_types_member_read" on public.leave_types
  for select to authenticated using (
    exists (select 1 from public.organization_members m
      where m.organization_id = leave_types.organization_id
        and m.user_id = auth.uid() and m.status = 'active')
  );
create policy "leave_types_approver_write" on public.leave_types
  for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','hr']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','hr']));

create policy "public_holidays_member_read" on public.public_holidays
  for select to authenticated using (
    exists (select 1 from public.organization_members m
      where m.organization_id = public_holidays.organization_id
        and m.user_id = auth.uid() and m.status = 'active')
  );
create policy "public_holidays_approver_write" on public.public_holidays
  for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','hr']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','hr']));

-- ledger: own rows readable; approvers read all and may write adjustments
create policy "leave_ledger_own_read" on public.leave_ledger
  for select to authenticated using (user_id = auth.uid());
create policy "leave_ledger_approver_all" on public.leave_ledger
  for all to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','hr']))
  with check (public.has_org_role(organization_id, array['owner','org_admin','hr']));

-- requests: own insert (pending only) + own read; approvers read all.
-- Status changes go through RPCs only — no direct update policy for owners.
create policy "leave_requests_own_read" on public.leave_requests
  for select to authenticated using (user_id = auth.uid());
create policy "leave_requests_own_insert" on public.leave_requests
  for insert to authenticated with check (
    user_id = auth.uid() and status = 'pending'
    and exists (select 1 from public.organization_members m
      where m.organization_id = leave_requests.organization_id
        and m.user_id = auth.uid() and m.status = 'active')
  );
create policy "leave_requests_approver_read" on public.leave_requests
  for select to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','hr']));

create policy "leave_credit_requests_own_read" on public.leave_credit_requests
  for select to authenticated using (user_id = auth.uid());
create policy "leave_credit_requests_own_insert" on public.leave_credit_requests
  for insert to authenticated with check (
    user_id = auth.uid() and status = 'pending'
    and exists (select 1 from public.organization_members m
      where m.organization_id = leave_credit_requests.organization_id
        and m.user_id = auth.uid() and m.status = 'active')
  );
create policy "leave_credit_requests_approver_read" on public.leave_credit_requests
  for select to authenticated
  using (public.has_org_role(organization_id, array['owner','org_admin','hr']));

-- 4. Grants (RLS alone -> 42501) ---------------------------------------------
grant select, insert, update, delete on public.leave_types to authenticated;
grant select, insert, update, delete on public.leave_ledger to authenticated;
grant select, insert, update, delete on public.leave_requests to authenticated;
grant select, insert, update, delete on public.leave_credit_requests to authenticated;
grant select, insert, update, delete on public.public_holidays to authenticated;

-- "Who's away": colleagues see only who/type/when of approved leave — never
-- justification, attachments, or decision notes. The view (definer-owned,
-- bypasses base RLS) scopes rows to orgs the caller is an active member of.
create or replace view public.leave_whos_away as
select r.organization_id, r.user_id, r.leave_type_id, r.start_date, r.end_date
from public.leave_requests r
where r.status = 'approved'
  and exists (
    select 1 from public.organization_members m
    where m.organization_id = r.organization_id
      and m.user_id = auth.uid() and m.status = 'active');

grant select on public.leave_whos_away to authenticated;

-- 5. Seed defaults for every existing org ------------------------------------
insert into public.leave_types
  (organization_id, code, name, entitlement_days, accrual, carry_forward_cap, requires_attachment, sort)
select o.id, t.code, t.name, t.entitlement_days, t.accrual, t.cap, t.req_att, t.sort
from public.organizations o
cross join (values
  ('annual',          'Annual',          12::numeric, 'pro_rata', 6::numeric, false, 1),
  ('medical',         'Medical',         14::numeric, 'full',     null,       true,  2),
  ('hospitalization', 'Hospitalization', 60::numeric, 'full',     null,       true,  3),
  ('paternity',       'Paternity',        7::numeric, 'full',     null,       false, 4),
  ('emergency',       'Emergency',       null,        'full',     null,       false, 5),
  ('unpaid',          'Unpaid',          null,        'full',     null,       false, 6)
) as t(code, name, entitlement_days, accrual, cap, req_att, sort)
on conflict (organization_id, code) do nothing;

insert into public.public_holidays (organization_id, holiday_date, name)
select o.id, h.d::date, h.n
from public.organizations o
cross join (values
  ('2026-01-01','New Year''s Day'), ('2026-02-17','Chinese New Year'),
  ('2026-02-18','Chinese New Year (2nd day)'), ('2026-03-21','Hari Raya Puasa'),
  ('2026-03-22','Hari Raya Puasa (2nd day)'), ('2026-05-01','Labour Day'),
  ('2026-05-27','Hari Raya Haji'), ('2026-05-31','Wesak Day'),
  ('2026-06-01','Agong''s Birthday'), ('2026-06-17','Awal Muharram'),
  ('2026-08-25','Prophet Muhammad''s Birthday'), ('2026-08-31','Merdeka Day'),
  ('2026-09-16','Malaysia Day'), ('2026-11-08','Deepavali'),
  ('2026-12-25','Christmas Day')
) as h(d, n)
on conflict (organization_id, holiday_date, name) do nothing;

-- 6. Attachment bucket (private; own write+read, approvers read) -------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('leave-attachments','leave-attachments', false, 5242880,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- object names: {organization_id}/{user_id}/{uuid}.{ext}
drop policy if exists "leave_att_own_rw" on storage.objects;
create policy "leave_att_own_rw" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'leave-attachments'
    and (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'leave-attachments'
    and (storage.foldername(name))[2] = auth.uid()::text
    and (storage.foldername(name))[1] in (
      select organization_id::text from public.organization_members
      where user_id = auth.uid() and status = 'active')
  );

drop policy if exists "leave_att_approver_read" on storage.objects;
create policy "leave_att_approver_read" on storage.objects
  for select to authenticated using (
    bucket_id = 'leave-attachments'
    and (storage.foldername(name))[1] in (
      select organization_id::text from public.organization_members
      where user_id = auth.uid() and status = 'active'
        and role in ('owner','org_admin','hr'))
  );

commit;
