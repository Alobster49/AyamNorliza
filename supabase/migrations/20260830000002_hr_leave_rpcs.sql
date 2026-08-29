-- Leave decision RPCs. All balance-changing decisions happen here, atomically,
-- so two approvers acting at once cannot overspend a balance.
-- Mirrors src/features/hr/lib/leave-model.ts (accrual by month, CF-first).

begin;

-- Available balance as the approver decides: base accrued + unexpired CF
-- + unexpired credits - approved usage - pending holds (excluding p_exclude).
-- As-of convention: p_as_of is the LEAVE START DATE (see approve_leave_request
-- below, which passes r.start_date, and leave-model.ts's header comment) --
-- not "today". A December request is checked against December's full
-- accrual, not however much has accrued by the day someone applies or approves.
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

-- One carry-forward grant per member/type/year — close_leave_year's
-- idempotency check races without this backstop.
create unique index if not exists leave_ledger_carry_forward_uniq
  on public.leave_ledger (organization_id, user_id, leave_type_id, year)
  where kind = 'carry_forward';

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

  -- Serialize decisions per (org, user, type, year): two approvers acting on
  -- different requests of the same member would otherwise both read the same
  -- cf_remaining and double-allocate carry-forward.
  perform pg_advisory_xact_lock(
    hashtextextended(r.organization_id::text || ':' || r.user_id::text || ':'
                     || r.leave_type_id::text || ':' || r.year::text, 0));

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
  v_inserted integer;
begin
  if not public.has_org_role(p_org, array['owner','org_admin','hr']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  -- Serialize year-close runs per org/year: the idempotency check below
  -- (exists ... continue) races against a concurrent close_leave_year call
  -- without this lock; the unique index is the hard backstop underneath it.
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_year::text, 0));

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
      -- Pending requests still hold balance here: clear the approval queue
      -- before closing the year, or the held days are excluded from
      -- carry-forward permanently.
      select available into v_avail
      from public.leave_available(
        p_org, v_member.user_id, v_type.id, p_year, make_date(p_year, 12, 31));

      v_carry := least(greatest(coalesce(v_avail, 0), 0), v_type.carry_forward_cap);
      if v_carry <= 0 then continue; end if;

      insert into public.leave_ledger
        (organization_id, user_id, leave_type_id, year, kind, days, expires_on, note, created_by)
      values
        (p_org, v_member.user_id, v_type.id, p_year + 1, 'carry_forward', v_carry,
         make_date(p_year + 1, 10, 31), 'year close ' || p_year, auth.uid())
      on conflict (organization_id, user_id, leave_type_id, year)
        where kind = 'carry_forward'
        do nothing;
      get diagnostics v_inserted = row_count;
      if v_inserted > 0 then v_count := v_count + 1; end if;
    end loop;
  end loop;

  return v_count;
end;
$$;
revoke all on function public.close_leave_year(uuid, int) from public;
grant execute on function public.close_leave_year(uuid, int) to authenticated;

commit;
