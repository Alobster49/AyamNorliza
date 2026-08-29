-- HR leave hardening: final-review must-fix items on top of
-- 20260830000001/20260830000002.
--
-- 1. Direct-insert bypass: a member can INSERT leave_requests via PostgREST
--    with a bogus day_count/year, or a leave_type_id belonging to a
--    different org, and approve_leave_request would trust both (it only
--    re-checks the *balance*, not that day_count/year/leave_type_id were
--    computed honestly). A BEFORE INSERT trigger now recomputes year and
--    day_count server-side from start_date/end_date/organization_id — the
--    same inputs the client already sends and cannot spoof around — and
--    rejects a leave_type_id from another org. Mirrors leave-model.ts's
--    workdayCount (Mon-Fri minus this org's public_holidays).
-- 2. leave_available had no auth check at all: any authenticated user could
--    call it for any other user's balance. Added the same
--    self-or-approver check the RPCs beside it already use.
-- 3. leave_type_id FKs were `on delete cascade`, silently deleting ledger/
--    request history if a leave type is ever deleted. Changed to
--    `on delete restrict` — deleting a leave type with any history now
--    fails loudly instead of erasing it.

begin;

-- ---------------------------------------------------------------------------
-- 1a. Workday count, server-side (mirrors leave-model.ts's workdayCount):
-- inclusive Mon-Fri count between p_start/p_end, minus this org's
-- public_holidays that fall on a counted weekday. security definer so a
-- plain member (who can only read their own org's holidays via RLS, which
-- is fine here) gets a consistent answer regardless of caller privileges —
-- revoked from public and re-granted to authenticated only, same pattern as
-- every other function in this feature.
-- ---------------------------------------------------------------------------
create or replace function public.leave_workday_count(p_org uuid, p_start date, p_end date)
returns numeric
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(count(*), 0)::numeric
  from generate_series(p_start, p_end, interval '1 day') as d(day)
  where extract(isodow from d.day) < 6  -- 1..5 = Mon..Fri (isodow: Mon=1..Sun=7)
    and not exists (
      select 1 from public.public_holidays h
      where h.organization_id = p_org and h.holiday_date = d.day::date
    );
$$;
revoke all on function public.leave_workday_count(uuid, date, date) from public;
grant execute on function public.leave_workday_count(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 1b. leave_requests: force year/day_count from the row's own dates/org —
-- never trust a client-supplied value — and refuse a leave_type_id that
-- belongs to a different org (PostgREST insert has no such cross-table
-- check otherwise).
-- ---------------------------------------------------------------------------
create or replace function public.leave_requests_before_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_type_org uuid;
begin
  select organization_id into v_type_org
  from public.leave_types where id = new.leave_type_id;

  if v_type_org is null or v_type_org <> new.organization_id then
    raise exception using errcode = 'P0001', message = 'validation';
  end if;

  new.year := extract(year from new.start_date)::int;
  new.day_count := public.leave_workday_count(new.organization_id, new.start_date, new.end_date);

  if new.day_count <= 0 then
    raise exception using errcode = 'P0001', message = 'validation';
  end if;

  return new;
end;
$$;

drop trigger if exists leave_requests_before_insert_trg on public.leave_requests;
create trigger leave_requests_before_insert_trg
  before insert on public.leave_requests
  for each row execute function public.leave_requests_before_insert();

-- ---------------------------------------------------------------------------
-- 1c. leave_credit_requests: same cross-org leave_type_id guard. No day-count
-- to recompute here — `amount` is a member-declared replacement-leave claim,
-- checked by an approver before it ever touches a balance (approve_leave_credit).
-- ---------------------------------------------------------------------------
create or replace function public.leave_credit_requests_before_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_type_org uuid;
begin
  select organization_id into v_type_org
  from public.leave_types where id = new.leave_type_id;

  if v_type_org is null or v_type_org <> new.organization_id then
    raise exception using errcode = 'P0001', message = 'validation';
  end if;

  return new;
end;
$$;

drop trigger if exists leave_credit_requests_before_insert_trg on public.leave_credit_requests;
create trigger leave_credit_requests_before_insert_trg
  before insert on public.leave_credit_requests
  for each row execute function public.leave_credit_requests_before_insert();

-- ---------------------------------------------------------------------------
-- 2. leave_available: add the missing auth check. Same shape as every other
-- RPC in this feature (self or owner/org_admin/hr) — this one just never had
-- it, so any authenticated user could read any other member's balance.
-- ---------------------------------------------------------------------------
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
  if not (p_user = auth.uid()
          or public.has_org_role(p_org, array['owner','org_admin','hr'])) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

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

-- ---------------------------------------------------------------------------
-- 3. leave_type_id FKs: cascade -> restrict. These were declared inline with
-- no explicit constraint name, so Postgres assigned the default
-- `<table>_<column>_fkey` name — asserted here (rather than looked up
-- dynamically) since that naming is deterministic for a single-column FK.
-- ---------------------------------------------------------------------------
alter table public.leave_ledger
  drop constraint leave_ledger_leave_type_id_fkey,
  add constraint leave_ledger_leave_type_id_fkey
    foreign key (leave_type_id) references public.leave_types (id) on delete restrict;

alter table public.leave_requests
  drop constraint leave_requests_leave_type_id_fkey,
  add constraint leave_requests_leave_type_id_fkey
    foreign key (leave_type_id) references public.leave_types (id) on delete restrict;

alter table public.leave_credit_requests
  drop constraint leave_credit_requests_leave_type_id_fkey,
  add constraint leave_credit_requests_leave_type_id_fkey
    foreign key (leave_type_id) references public.leave_types (id) on delete restrict;

commit;
