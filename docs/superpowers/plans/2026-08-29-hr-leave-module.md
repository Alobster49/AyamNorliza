# HR Leave Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Leave management for every org member (apply, balances, history) plus a new `hr` role with an approval dashboard, per spec `docs/superpowers/specs/2026-08-29-hr-leave-module-design.md`.

**Architecture:** Full entitlement engine, hybrid: pure TS model (`leave-model.ts`, unit-tested) drives all UI numbers; SECURITY DEFINER SQL RPCs perform the mutating decisions (approve/reject/cancel/credit/year-close) atomically so concurrent approvals cannot overspend. New `src/features/hr` feature module; pages under the existing `(seller)/[organizationSlug]` shell.

**Tech Stack:** Next.js App Router, Supabase (Postgres RLS + RPC + Storage), next-intl, shadcn/ui, date-fns v4, vitest, Playwright.

## Global Constraints

- Every new table: explicit `grant select, insert, update, delete on ... to authenticated;` — RLS alone yields 42501. Every RPC: `revoke all ... from public; grant execute ... to authenticated;`.
- All test/seed accounts use password `password123` (project rule). Seed SQL uses the existing crypt pattern (`test-only-password-12-chars` in seed.sql is what demo-seed overwrites; follow whatever the file already does for other users).
- Roles that approve leave: `owner`, `org_admin`, `hr` — constant `LEAVE_APPROVER_ROLES` in `src/features/hr/lib/roles.ts`. Never inline these lists elsewhere.
- Business rules (fixed by spec):
  - Accrual `pro_rata` (Annual only): accrued = entitlement × monthIndex(asOf)/12 where monthIndex Jan=1..Dec=12 (current month counts fully). `full` types: whole entitlement from 1 Jan.
  - Day counting: Mon–Fri minus `public_holidays` rows in range. Zero-workday requests invalid.
  - Deduction order: unexpired carry-forward first, then base. Split recorded in `leave_requests.breakdown` at approval.
  - Carry-forward rows: `leave_ledger` kind `carry_forward`, expires 31 Oct of their year. Credit rows expire 31 Dec of their year.
  - Upon-request types (`entitlement_days IS NULL`, Emergency/Unpaid): no balance check ever.
  - Pending requests hold balance: available shown and enforced = carryForwardRemaining + accrued + credits − taken − pendingHeld.
- i18n: all user-visible strings via next-intl namespace `hr` (en + ms). e2e selects by visible label — write specs against final English copy only after UI tasks land.
- No `git stash`, no `git checkout <path>`. Work only inside this worktree.
- Commit after every green step; run `npm test` before each commit; `npm run typecheck` + `npm run lint` before final task completion.

---

### Task 1: DB schema migration (role, tables, RLS, seeds, storage)

**Files:**
- Create: `supabase/migrations/20260830000001_hr_leave_schema.sql`
- Test: `npm run db:reset` (must complete cleanly), then `npm run db:types`
- Modify: `src/types/database.generated.ts` (regenerated, committed)

**Interfaces:**
- Produces: tables `leave_types`, `leave_ledger`, `leave_requests`, `leave_credit_requests`, `public_holidays`; bucket `leave-attachments`; role `hr` valid in `organization_members`/`invitations`/`role_capability_overrides`.

- [ ] **Step 1: Write the migration**

```sql
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

-- NOTE for implementer: before committing, open the latest prior migration that
-- touched these constraints and copy ITS role list + add 'hr' — the lists above
-- must match current reality (driver was added after the 20260718 migration;
-- verify with: grep -rn "organization_members_role_check" supabase/migrations | tail -1).

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
```

- [ ] **Step 2: Reset DB, confirm clean apply**

Run: `npm run db:reset`
Expected: finishes without error (watch for policy/constraint typos).

- [ ] **Step 3: Regenerate types**

Run: `npm run db:types`
Expected: `src/types/database.generated.ts` now contains `leave_types`, `leave_requests`, etc.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260830000001_hr_leave_schema.sql src/types/database.generated.ts
git commit -m "feat(hr): leave schema — hr role, tables, RLS, seeds, attachment bucket"
```

---

### Task 2: RPC migration (approve/reject/cancel, credits, year-close)

**Files:**
- Create: `supabase/migrations/20260830000002_hr_leave_rpcs.sql`
- Test: `npm run db:reset`

**Interfaces:**
- Consumes: Task 1 tables.
- Produces RPCs (all `security definer`, `set search_path = public, pg_temp`, errors via `raise exception ... errcode='P0001', message='<code>'`):
  - `leave_available(p_org uuid, p_user uuid, p_type uuid, p_year int, p_as_of date) returns table(available numeric, cf_remaining numeric)`
  - `approve_leave_request(p_request uuid, p_note text) returns void` — error codes: `not_found`, `forbidden`, `invalid_status`, `insufficient_balance`
  - `reject_leave_request(p_request uuid, p_note text) returns void` — `not_found`, `forbidden`, `invalid_status`
  - `cancel_leave_request(p_request uuid) returns void` — own + pending only: `not_found`, `forbidden`, `invalid_status`
  - `approve_leave_credit(p_request uuid, p_note text) returns void` / `reject_leave_credit(p_request uuid, p_note text) returns void`
  - `close_leave_year(p_org uuid, p_year int) returns integer` (rows inserted)

- [ ] **Step 1: Write the migration**

```sql
-- Leave decision RPCs. All balance-changing decisions happen here, atomically,
-- so two approvers acting at once cannot overspend a balance.
-- Mirrors src/features/hr/lib/leave-model.ts (accrual by month, CF-first).

begin;

-- Available balance as the approver decides: base accrued + unexpired CF
-- + unexpired credits - approved usage - pending holds (excluding p_exclude).
create or replace function public.leave_available(
  p_org uuid, p_user uuid, p_type uuid, p_year int, p_as_of date,
  p_exclude uuid default null
)
returns table (available numeric, cf_remaining numeric)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_entitlement numeric;
  v_accrual text;
  v_accrued numeric;
  v_cf numeric;
  v_credits numeric;
  v_cf_used numeric;
  v_base_used numeric;
  v_pending numeric;
begin
  select entitlement_days, accrual into v_entitlement, v_accrual
  from public.leave_types where id = p_type and organization_id = p_org;

  if v_entitlement is null then
    -- upon-request type: unlimited
    return query select null::numeric, 0::numeric;
    return;
  end if;

  v_accrued := case when v_accrual = 'pro_rata'
    then round(v_entitlement * extract(month from p_as_of) / 12.0, 2)
    else v_entitlement end;

  select coalesce(sum(days), 0) into v_cf
  from public.leave_ledger
  where organization_id = p_org and user_id = p_user
    and leave_type_id = p_type and year = p_year
    and kind = 'carry_forward'
    and (expires_on is null or expires_on >= p_as_of);

  select coalesce(sum(days), 0) into v_credits
  from public.leave_ledger
  where organization_id = p_org and user_id = p_user
    and leave_type_id = p_type and year = p_year
    and kind in ('credit','adjustment')
    and (expires_on is null or expires_on >= p_as_of);

  select coalesce(sum((breakdown->>'carry_forward_used')::numeric), 0),
         coalesce(sum((breakdown->>'base_used')::numeric), 0)
    into v_cf_used, v_base_used
  from public.leave_requests
  where organization_id = p_org and user_id = p_user
    and leave_type_id = p_type and year = p_year and status = 'approved';

  select coalesce(sum(day_count), 0) into v_pending
  from public.leave_requests
  where organization_id = p_org and user_id = p_user
    and leave_type_id = p_type and year = p_year and status = 'pending'
    and (p_exclude is null or id <> p_exclude);

  return query select
    greatest(v_cf - v_cf_used, 0) + v_accrued + v_credits - v_base_used - v_pending,
    greatest(v_cf - v_cf_used, 0);
end;
$$;
revoke all on function public.leave_available(uuid, uuid, uuid, int, date, uuid) from public;
grant execute on function public.leave_available(uuid, uuid, uuid, int, date, uuid) to authenticated;

create or replace function public.approve_leave_request(p_request uuid, p_note text default null)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_avail numeric;
  v_cf_rem numeric;
  v_cf_used numeric;
begin
  select * into r from public.leave_requests where id = p_request for update;
  if r.id is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;
  if not public.has_org_role(r.organization_id, array['owner','org_admin','hr']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if r.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  select available, cf_remaining into v_avail, v_cf_rem
  from public.leave_available(
    r.organization_id, r.user_id, r.leave_type_id, r.year, r.start_date, r.id);

  -- v_avail null = upon-request type: always approvable.
  if v_avail is not null and v_avail < r.day_count then
    raise exception using errcode = 'P0001', message = 'insufficient_balance';
  end if;

  v_cf_used := case when v_avail is null then 0
    else least(coalesce(v_cf_rem, 0), r.day_count) end;

  update public.leave_requests
  set status = 'approved',
      decided_by = auth.uid(),
      decided_at = now(),
      decision_note = p_note,
      breakdown = jsonb_build_object(
        'carry_forward_used', v_cf_used,
        'base_used', r.day_count - v_cf_used)
  where id = p_request;
end;
$$;
revoke all on function public.approve_leave_request(uuid, text) from public;
grant execute on function public.approve_leave_request(uuid, text) to authenticated;

create or replace function public.reject_leave_request(p_request uuid, p_note text default null)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  select * into r from public.leave_requests where id = p_request for update;
  if r.id is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;
  if not public.has_org_role(r.organization_id, array['owner','org_admin','hr']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if r.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;
  update public.leave_requests
  set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = p_note
  where id = p_request;
end;
$$;
revoke all on function public.reject_leave_request(uuid, text) from public;
grant execute on function public.reject_leave_request(uuid, text) to authenticated;

create or replace function public.cancel_leave_request(p_request uuid)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  select * into r from public.leave_requests where id = p_request for update;
  if r.id is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;
  if r.user_id <> auth.uid() then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if r.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;
  update public.leave_requests set status = 'cancelled' where id = p_request;
end;
$$;
revoke all on function public.cancel_leave_request(uuid) from public;
grant execute on function public.cancel_leave_request(uuid) to authenticated;

create or replace function public.approve_leave_credit(p_request uuid, p_note text default null)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  select * into r from public.leave_credit_requests where id = p_request for update;
  if r.id is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;
  if not public.has_org_role(r.organization_id, array['owner','org_admin','hr']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if r.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  update public.leave_credit_requests
  set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = p_note
  where id = p_request;

  insert into public.leave_ledger
    (organization_id, user_id, leave_type_id, year, kind, days, expires_on, note, created_by)
  values
    (r.organization_id, r.user_id, r.leave_type_id,
     extract(year from r.reference_start)::int, 'credit', r.amount,
     make_date(extract(year from r.reference_start)::int, 12, 31),
     'credit request ' || r.id, auth.uid());
end;
$$;
revoke all on function public.approve_leave_credit(uuid, text) from public;
grant execute on function public.approve_leave_credit(uuid, text) to authenticated;

create or replace function public.reject_leave_credit(p_request uuid, p_note text default null)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  select * into r from public.leave_credit_requests where id = p_request for update;
  if r.id is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;
  if not public.has_org_role(r.organization_id, array['owner','org_admin','hr']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  if r.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;
  update public.leave_credit_requests
  set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = p_note
  where id = p_request;
end;
$$;
revoke all on function public.reject_leave_credit(uuid, text) from public;
grant execute on function public.reject_leave_credit(uuid, text) to authenticated;

-- Year close: unused annual (per member) -> capped carry-forward rows for
-- p_year+1, expiring 31 Oct. Idempotent: members that already have a
-- carry_forward row for p_year+1 are skipped.
create or replace function public.close_leave_year(p_org uuid, p_year int)
returns integer
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_type record;
  v_member record;
  v_avail numeric;
  v_cf_rem numeric;
  v_carry numeric;
  v_count integer := 0;
begin
  if not public.has_org_role(p_org, array['owner','org_admin','hr']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  for v_type in
    select id, carry_forward_cap from public.leave_types
    where organization_id = p_org and carry_forward_cap is not null
      and entitlement_days is not null
  loop
    for v_member in
      select user_id from public.organization_members
      where organization_id = p_org and status = 'active'
    loop
      if exists (
        select 1 from public.leave_ledger
        where organization_id = p_org and user_id = v_member.user_id
          and leave_type_id = v_type.id and year = p_year + 1
          and kind = 'carry_forward'
      ) then continue; end if;

      -- as-of 31 Dec: full accrual, expired CF already excluded.
      select available into v_avail
      from public.leave_available(
        p_org, v_member.user_id, v_type.id, p_year, make_date(p_year, 12, 31));

      v_carry := least(greatest(coalesce(v_avail, 0), 0), v_type.carry_forward_cap);
      if v_carry <= 0 then continue; end if;

      insert into public.leave_ledger
        (organization_id, user_id, leave_type_id, year, kind, days, expires_on, note, created_by)
      values
        (p_org, v_member.user_id, v_type.id, p_year + 1, 'carry_forward', v_carry,
         make_date(p_year + 1, 10, 31), 'year close ' || p_year, auth.uid());
      v_count := v_count + 1;
    end loop;
  end loop;

  return v_count;
end;
$$;
revoke all on function public.close_leave_year(uuid, int) from public;
grant execute on function public.close_leave_year(uuid, int) to authenticated;

commit;
```

- [ ] **Step 2: Reset DB**

Run: `npm run db:reset`
Expected: clean.

- [ ] **Step 3: Smoke the RPCs via psql**

Run (adjust port from `supabase status`):
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select public.leave_available('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000',2026,'2026-08-29');"
```
Expected: one row `(null-or-0 …)` — no SQL error (nonexistent ids exercise the null path).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260830000002_hr_leave_rpcs.sql
git commit -m "feat(hr): leave decision RPCs — atomic approve with CF-first split, credits, year close"
```

---

### Task 3: App-side role wiring (permissions, seed account, landing)

**Files:**
- Modify: `src/lib/auth/permissions.ts` (add `"hr"` to ROLES)
- Modify: `src/features/data-console/lib/accounts.ts` (add hr account)
- Modify: `supabase/seed.sql` (add hr user to seed_users list — follow the file's existing user rows exactly)
- Modify: the landing decision file (grep `landing` under `src/**/server` — memory says `server/landing.ts`): role `hr` lands on `/{organizationSlug}/leave/manage`
- Modify: `e2e/_fixtures.ts` signIn landing regex — add `[^/]+\/leave\/manage` alternative
- Create: `src/features/hr/lib/roles.ts`

**Interfaces:**
- Produces: `LEAVE_APPROVER_ROLES = ["owner","org_admin","hr"] as const` and `ALL_MEMBER_ROLES` (= full ROLES list re-export) in `src/features/hr/lib/roles.ts`.

- [ ] **Step 1: roles.ts**

```typescript
import { ROLES } from "@/lib/auth/permissions";

/** Roles that may act on leave/credit requests and edit leave settings. */
export const LEAVE_APPROVER_ROLES = ["owner", "org_admin", "hr"] as const;

/** Every org member may open My Leave — drivers included. */
export const ALL_MEMBER_ROLES = ROLES;
```

- [ ] **Step 2: permissions.ts — add `"hr"` to the ROLES array** (keep ordering near org_admin).

- [ ] **Step 3: accounts.ts — add row**

```typescript
{ email: "hr@gmail.com", displayName: "HR Manager", role: "hr" },
```
Verify `seedDemoData` in `src/features/data-console/server/actions.ts` iterates `CONSOLE_ACCOUNTS` generically (it should pick the new row up with password123 — read it to confirm; if roles are switch-cased anywhere, add `hr`).

- [ ] **Step 4: seed.sql — add hr@gmail.com to seed_users** with role `hr`, copying an existing user row's shape (same password expression, new fixed uuid following the file's id scheme).

- [ ] **Step 5: landing + e2e regex** — hr lands on `leave/manage`; extend the `_fixtures.ts` URL regex alternation accordingly.

- [ ] **Step 6: Verify + commit**

Run: `npm run db:reset && npm test && npm run typecheck`
Expected: all green.

```bash
git add -A
git commit -m "feat(hr): hr role wiring — permissions, console account, seed user, landing"
```

---

### Task 4: leave-model.ts (TDD — the engine)

**Files:**
- Create: `src/features/hr/lib/leave-model.ts`
- Create: `src/features/hr/types.ts`
- Test: `src/features/hr/tests/unit/leave-model.test.ts`

**Interfaces (Produces — later tasks import these exact names):**

```typescript
// types.ts
export type LeaveTypeInfo = {
  id: string;
  code: string;
  name: string;
  entitlementDays: number | null;   // null = upon-request
  accrual: "pro_rata" | "full";
  carryForwardCap: number | null;
  requiresAttachment: boolean;
  sort: number;
};
export type LedgerEntry = {
  leaveTypeId: string;
  year: number;
  kind: "carry_forward" | "credit" | "adjustment";
  days: number;
  expiresOn: string | null;         // ISO date
};
export type LeaveRequestSummary = {
  id: string;
  leaveTypeId: string;
  year: number;
  startDate: string;
  endDate: string;
  dayCount: number;
  status: "pending" | "approved" | "rejected" | "cancelled";
  breakdown: { carryForwardUsed: number; baseUsed: number } | null;
};
export type BalanceSummary = {
  uponRequest: boolean;
  entitlement: number;              // 0 when uponRequest
  accrued: number;
  carryForward: number;             // granted, unexpired as of asOf
  carryForwardExpiresOn: string | null;
  credits: number;
  takenBase: number;
  takenCarryForward: number;
  pendingHeld: number;
  available: number;                // Infinity when uponRequest
};

// leave-model.ts
export function accruedDays(type: LeaveTypeInfo, asOf: string): number;
export function workdayCount(startDate: string, endDate: string, holidays: string[]): number;
export function computeBalance(
  type: LeaveTypeInfo,
  ledger: LedgerEntry[],
  requests: LeaveRequestSummary[],
  year: number,
  asOf: string,
): BalanceSummary;
export function validateApplication(input: {
  type: LeaveTypeInfo;
  startDate: string;
  endDate: string;
  dayCount: number;
  balance: BalanceSummary;
  attachmentProvided: boolean;
}): { ok: true } | { ok: false; reason: "invalid_range" | "zero_workdays" | "insufficient_balance" | "attachment_required" };
```

Rules to implement (identical to the SQL in Task 2 — divergence is a bug):
- `accruedDays`: pro_rata → `round2(entitlement * monthIndex(asOf) / 12)` (Jan=1); full → entitlement; upon-request → 0.
- `workdayCount`: inclusive range, count Mon–Fri, subtract holidays that fall on counted days. Use date-fns (`eachDayOfInterval`, `isWeekend`, `parseISO`, `format`).
- `computeBalance`: CF = sum of carry_forward rows for (type, year) unexpired at asOf; credits = credit+adjustment rows unexpired; takenCF/takenBase from approved rows' breakdowns; pendingHeld = sum pending day_count; available = max(CF − takenCF, 0) + accrued + credits − takenBase − pendingHeld. Upon-request: `available = Infinity`, `uponRequest = true`.
- `validateApplication`: end ≥ start; dayCount > 0; attachment when `requiresAttachment`; balance check skipped for upon-request.

- [ ] **Step 1: Write failing tests** — cover at minimum (use vitest `describe/it`, fixture builders like weigh-model.test.ts):

```typescript
// accrual
it("pro-rata: Annual 12 at 2026-08-29 -> 8.00")
it("pro-rata: at 2026-01-15 -> 1.00; at 2026-12-01 -> 12.00")
it("full: Medical 14 available in full from 2026-01-02")
it("upon-request: accrued 0")
// workdayCount
it("Tue..Fri no holidays -> 4")               // 2026-03-24..2026-03-27
it("Mon..Sun -> 5")                            // weekend excluded
it("range containing a holiday on a weekday subtracts it")
it("holiday on Saturday changes nothing")
it("single Sunday -> 0")
// computeBalance (mirror screenshot 1: CF 6 + accrued 8 - taken 4 = 10, all 4 taken from CF)
it("carry-forward consumed before base (breakdown sums)")
it("CF expired at asOf: granted CF excluded from available, takenCF unchanged")
it("pending requests hold balance")
it("credits add to available until their expiry")
it("upon-request type: available Infinity")
// validateApplication
it("rejects end < start; rejects zero workdays; rejects over-balance; requires attachment when type demands")
```

Every test asserts exact numbers. Write real implementations of the fixture builders (a `makeType`, `makeLedger`, `makeRequest` helper each ~5 lines).

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/features/hr/tests/unit/leave-model.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement leave-model.ts + types.ts** per interfaces above. Header comment mirrors weigh-model.ts style ("Pure model… No React, no DOM").

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/features/hr/tests/unit/leave-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + commit**

Run: `npm test`

```bash
git add src/features/hr
git commit -m "feat(hr): pure leave model — accrual, workday count, CF-first balance"
```

---

### Task 5: Server actions

**Files:**
- Create: `src/features/hr/server/guards.ts`
- Create: `src/features/hr/server/leave-actions.ts`
- Create: `src/features/hr/server/manage-actions.ts`

**Interfaces:**
- Consumes: Task 4 types; RPCs from Task 2; `requireOrgRole`/`OrderPermissionError` from `@/features/orders/server/guards`; `createSupabaseServerClient` from `@/lib/supabase/server`; `LEAVE_APPROVER_ROLES`, `ALL_MEMBER_ROLES` from Task 3.
- Produces (all return the repo's `ActionResult<T>` shape `{ok:true,data}|{ok:false,code,message}` — copy the `ok/err` helpers from driver-actions.ts):
  - `getMyLeaveData(slug, year)` → `{ types: LeaveTypeInfo[]; ledger: LedgerEntry[]; requests: MyLeaveRequestRow[]; creditRequests: CreditRequestRow[]; holidays: {date,name}[]; whosAway: {displayName, startDate, endDate, typeName}[]; viewer: {userId, role, displayName} }` — `whosAway` reads from the `public.leave_whos_away` view (safe columns only: user_id/leave_type_id/start_date/end_date), joining display names and leave type names server-side; never selects from `leave_requests` directly for this list
  - `applyLeave(slug, input: {leaveTypeId, startDate, endDate, justification, attachmentPath?})` → inserts pending request; server recomputes `day_count` via `workdayCount` + holidays and validates via `validateApplication` (client numbers are advisory only)
  - `requestLeaveCredit(slug, input: {leaveTypeId, amount, referenceStart, referenceEnd, justification?, attachmentPath?})`
  - `cancelMyLeaveRequest(slug, requestId)` → RPC `cancel_leave_request`
  - `getManageData(slug, year)` (approvers) → `{ pending: PendingLeaveRow[]; pendingCredits: PendingCreditRow[]; staff: StaffBalanceRow[]; types; holidays }` — staff balances computed by calling `computeBalance` per member/type
  - `decideLeave(slug, requestId, action: "approve"|"reject", note?)` → RPCs; map RPC message codes (`insufficient_balance` etc.) to `messageKey` `hr.errors.<code>` (rpc-errors pattern)
  - `decideCredit(slug, requestId, action, note?)`
  - `saveHoliday(slug, {date,name})` / `deleteHoliday(slug, id)`
  - `updateLeaveType(slug, id, {entitlementDays, carryForwardCap, requiresAttachment})`
  - `closeYear(slug, year)` → RPC `close_leave_year`, returns inserted count
- Display names: join via the same person-name source `getTodayTasks` uses (grep how `people` map is built in `order-actions.ts` — reuse that helper/pattern, do not invent a new query shape).

- [ ] **Step 1: Implement guards.ts** — `requireLeaveApprover(slug)` and `requireMember(slug)` thin wrappers over `requireOrgRole` with the Task 3 constants.
- [ ] **Step 2: Implement leave-actions.ts** (member-facing; every action `"use server"`, guard first, then narrow selects; attachment path is stored verbatim — upload happens client-side to `leave-attachments/{orgId}/{userId}/{uuid}.{ext}`).
- [ ] **Step 3: Implement manage-actions.ts** (approver-facing; `revalidatePath` the two leave routes after mutations).
- [ ] **Step 4: Verify + commit**

Run: `npm run typecheck && npm test`

```bash
git add src/features/hr/server
git commit -m "feat(hr): leave server actions — member apply/credit, approver decide/settings"
```

---

### Task 6: Shell gate + sidebar + nav

**Files:**
- Modify: `src/app/[locale]/(seller)/[organizationSlug]/layout.tsx` — widen gate from STAFF_ROLES to **any active member** (`!member` alone redirects). Per-page guards stay the real security boundary (this matches the file's own CONTRACT CONCERN comment). Update that comment.
- Modify: `src/features/dashboard/components/dashboard-shell-model.ts`:
  - New group in `routeGroups`: `{ title: "HR", sectionKey: "sections.hr", items: [{ titleKey: "pages.myLeave", segment: "leave" }, { titleKey: "pages.leaveManagement", segment: "leave/manage" }] }`.
  - `leave/manage` item filtered out unless `role` ∈ LEAVE_APPROVER_ROLES (keep the role lists local to this file like STAFF_ONLY_ROLES does).
  - STAFF_ONLY_ROLES branch: append My Leave item.
  - New branch: roles that are neither managers nor STAFF_ONLY (e.g. `driver`, `hr`): `hr` → HR group only (both items); any other non-manager role → HR group with My Leave only.
- Modify: `src/messages/en.json` + `ms.json` `dashboard` namespace: `sections.hr`, `pages.myLeave`, `pages.leaveManagement`.
- Test: extend the existing dashboard-shell model unit test if one exists (grep `dashboard-shell-model` under tests; if a test file exists, add cases: hr sees both items, driver sees My Leave only, owner sees group + manage).

- [ ] **Step 1: Implement, adding tests where a model test file already exists**
- [ ] **Step 2: Verify + commit**

Run: `npm test && npm run typecheck`

```bash
git add -A
git commit -m "feat(hr): open shell to all members, HR sidebar group"
```

---

### Task 7: My Leave page

**Files:**
- Create: `src/app/[locale]/(seller)/[organizationSlug]/leave/page.tsx` (server: `requireMember`, fetch `getMyLeaveData(slug, year)`, hand to client; `searchParams.year` optional)
- Create: `src/features/hr/components/leave-client.tsx` (top-level client: year select, header, sections)
- Create: `src/features/hr/components/entitlement-header.tsx` — screenshot 1 equation card: Carry Forward (+ expiry line) ⊕ Annual Leave Accrued ⊖ Leave Taken (split lines "0 Annual taken / 4 Carry Forward taken") = Current Leave Balance; as-of `Select` (Today / End of year) recomputes via `computeBalance`.
- Create: `src/features/hr/components/policy-cards.tsx` — one card per non-annual type: available number or "Upon Request", "N booked" line when pending > 0.
- Create: `src/features/hr/components/apply-leave-dialog.tsx` — screenshot 3: year select, radio list of types with live remaining (from `computeBalance` per type), start/end date inputs (`<Input type="date">`), justification `Textarea` (required), attachment `<Input type="file">` shown always, required when type.requiresAttachment; footer shows computed workday count ("4 days") once dates valid; submit → upload attachment (browser supabase client, path `{orgId}/{userId}/{crypto.randomUUID()}.{ext}`) → `applyLeave`. Toast on success/error; dialog form pattern = category-dialog.tsx.
- Create: `src/features/hr/components/request-credit-dialog.tsx` — screenshot 4 fields: credit type (Replacement), amount, reference date range, justification, attachment → `requestLeaveCredit`.
- Create: `src/features/hr/components/leave-history.tsx` — screenshot 2 table: filters (type Select, status Select, year lives in page header), columns Leave Type (colored dot + CF sub-label when breakdown.carryForwardUsed > 0), Date ("24 Mar - 27 Mar, Tue - Fri" via date-fns format), Count, Status `Badge` (approved=default/green, pending=secondary/amber, rejected=destructive, cancelled=outline), Last Comment (decision_note), row action Cancel (pending + own only → `cancelMyLeaveRequest` + ConfirmDialog — repo-wide component, grep its import).
- Create: `src/features/hr/components/whos-away.tsx` — Today / This week groups of approved absences (name, type, date range) + next 5 public holidays list.
- Modify: `src/messages/en.json` + `ms.json` — namespace `hr` (structure: `hr.nav`, `hr.myLeave.*`, `hr.apply.*`, `hr.credit.*`, `hr.history.*`, `hr.whosAway.*`, `hr.errors.*`). BM copy: translate honestly (Cuti Tahunan, Cuti Sakit, Mohon Cuti, etc.), not machine-stub.

**Interfaces:**
- Consumes: Task 4 model + types, Task 5 `getMyLeaveData`/`applyLeave`/`requestLeaveCredit`/`cancelMyLeaveRequest`.
- Client components use `useTranslations("hr")`, `useToast`, shadcn primitives only (`Card`, `Dialog`, `Select`, `Badge`, `Table`, `Tabs` not needed here).

- [ ] **Step 1: Build page + components** (mobile-first: cards stack at 375px, table wraps in `overflow-x-auto` container — repo mobile rule).
- [ ] **Step 2: Verify in browser** — `npm run dev` via Bash (worktree; do NOT preview_start), sign in as seller@gmail.com after data-console demo seed, open `/ayam-norliza-pilot/leave`, apply Annual leave for a Tue–Fri range, confirm history row PENDING with correct day count. `read_page` for verification, screenshot only as final proof.
- [ ] **Step 3: Gates + commit**

Run: `npm test && npm run typecheck && npm run lint`

```bash
git add -A
git commit -m "feat(hr): My Leave page — entitlement header, policy cards, apply/credit dialogs, history, who's away"
```

---

### Task 8: Leave Management page (HR dashboard)

**Files:**
- Create: `src/app/[locale]/(seller)/[organizationSlug]/leave/manage/page.tsx` (server: `requireLeaveApprover`, redirect non-approvers to `/{slug}/leave`; fetch `getManageData`)
- Create: `src/features/hr/components/manage-client.tsx` — `Tabs`: Requests / Staff balances / Holidays / Leave types / Year close.
- Create: `src/features/hr/components/pending-queue.tsx` — pending leave + credit requests (requester name, type, dates, day count, justification, attachment link via signed URL from a small server action `getAttachmentUrl(slug, path)` added to manage-actions.ts); Approve/Reject buttons each opening a note dialog; `insufficient_balance` RPC error surfaces as destructive toast with the translated message.
- Create: `src/features/hr/components/staff-balances.tsx` — table: member × balance-type columns showing `available` (from `computeBalance`), CF remaining as sub-text; year follows page-level year select.
- Create: `src/features/hr/components/holidays-editor.tsx` — list + add (date+name) + delete with ConfirmDialog.
- Create: `src/features/hr/components/leave-type-settings.tsx` — per type: entitlement days, CF cap, requires-attachment switch; save via `updateLeaveType`.
- Create: `src/features/hr/components/year-close-card.tsx` — year select + button "Close year N → carry forward into N+1" with ConfirmDialog; shows inserted count from `closeYear` in toast.
- Modify: `src/messages/en.json` + `ms.json` — `hr.manage.*` keys.

**Interfaces:**
- Consumes: Task 5 manage actions; Task 4 model for balances.

- [ ] **Step 1: Build page + components**
- [ ] **Step 2: Browser verify** — sign in hr@gmail.com (after re-running demo seed so the account exists), approve the pending request from Task 7's manual test, watch it flip to APPROVED and the staff balance drop by the day count.
- [ ] **Step 3: Gates + commit**

Run: `npm test && npm run typecheck && npm run lint`

```bash
git add -A
git commit -m "feat(hr): Leave Management — pending queue, staff balances, holidays, type settings, year close"
```

---

### Task 9: e2e spec

**Files:**
- Create: `e2e/hr-leave.spec.ts`
- Modify: `e2e/_fixtures.ts` only if the hr landing regex wasn't already added in Task 3.

- [ ] **Step 1: Write the spec** (labels must match the shipped English copy — read the built components first):

```typescript
import { test, expect } from "@playwright/test";
import { signIn } from "./_fixtures";

const WORKER = { email: "warehouse@gmail.com", password: "password123" };
const HR = { email: "hr@gmail.com", password: "password123" };

test("worker applies annual leave, HR approves, balance drops", async ({ page, browser }) => {
  test.setTimeout(120_000);

  // Worker applies (dates in a future week, Tue..Wed = 2 workdays; adjust if
  // they collide with seeded public holidays).
  await signIn(page, WORKER.email, WORKER.password);
  await page.goto("/ayam-norliza-pilot/leave");
  const before = await page.getByTestId("annual-available").innerText();
  await page.getByRole("button", { name: /apply leave/i }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: /annual/i }).first().check();
  await dialog.getByLabel(/start date/i).fill("2026-12-01");
  await dialog.getByLabel(/end date/i).fill("2026-12-02");
  await dialog.getByLabel(/justification/i).fill("E2E family matter");
  await dialog.getByRole("button", { name: /^apply$/i }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  await expect(page.getByRole("row").filter({ hasText: "E2E family matter" }))
    .toContainText(/pending/i);

  // HR approves in a fresh context.
  const hrContext = await browser.newContext();
  const hrPage = await hrContext.newPage();
  await signIn(hrPage, HR.email, HR.password);
  await hrPage.goto("/ayam-norliza-pilot/leave/manage");
  const rowCard = hrPage.getByTestId("pending-request").filter({ hasText: "E2E family matter" });
  await rowCard.getByRole("button", { name: /approve/i }).click();
  await hrPage.getByRole("dialog").getByRole("button", { name: /approve/i }).click();
  await expect(rowCard).toBeHidden({ timeout: 10_000 });

  // Worker sees APPROVED and a lower available balance.
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: "E2E family matter" }))
    .toContainText(/approved/i);
  const after = await page.getByTestId("annual-available").innerText();
  expect(parseFloat(after)).toBeLessThan(parseFloat(before));
  await hrContext.close();
});
```

Add `data-testid="annual-available"` on the header balance figure and `data-testid="pending-request"` on queue cards while building Tasks 7–8 (or add now and adjust). Requests seeded by earlier runs make reruns collide — use a unique justification (`E2E family matter ${Date.now()}`) and filter by it.

- [ ] **Step 2: Run it**

Run: `npx playwright test e2e/hr-leave.spec.ts`
Expected: PASS (dev server auto-started by playwright webServer on :9999; demo seed must have been run once so hr@gmail.com exists — run the data-console Seed action or `npm run db:reset` + seed action first).

- [ ] **Step 3: Commit**

```bash
git add e2e/hr-leave.spec.ts e2e/_fixtures.ts
git commit -m "test(hr): e2e apply→approve→balance-drop flow"
```

---

### Task 10: Final gates + docs

- [ ] **Step 1: Full verification**

Run: `npm test && npm run typecheck && npm run lint && npx playwright test e2e/hr-leave.spec.ts`
Expected: all green. Also `npm run db:reset` one last time (fresh DB applies both migrations cleanly).

- [ ] **Step 2: en.d.json.ts** — confirm `src/messages/en.d.json.ts` regenerated (next-intl emits during dev/build; if stale, run `npm run build` once or the dev server briefly) and committed.

- [ ] **Step 3: Commit any stragglers**

```bash
git add -A
git commit -m "chore(hr): final gates — types, lint, e2e green"
```

---

## Self-review notes

- Spec coverage: role+gating (T1,T3,T6), data model+storage (T1), engine TS+SQL (T2,T4), pages (T7,T8), i18n (T6–T8), tests (T4,T9), gotchas (grants in T1/T2, worktree dev server in T7, e2e labels in T9). Who's-away privacy handled via approved-only RLS policy + narrow selects.
- Type consistency: `breakdown` JSON keys `carry_forward_used`/`base_used` (SQL) map to `carryForwardUsed`/`baseUsed` (TS) — mapping happens in Task 5's row mappers; both sides defined above.
- Known risk: SQL `leave_available` and TS `computeBalance` must agree — both specified from the same rule list in Global Constraints; Task 4 tests pin the numbers, Task 9 e2e pins the SQL side end-to-end.
