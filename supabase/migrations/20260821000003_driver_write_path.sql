-- 20260821000003_driver_write_path.sql
-- Delivery runs redesign, phase 4: what the driver records at the door.
--
-- Until now a delivery either happened or the office heard about it on
-- WhatsApp. Three things get recorded from here on:
--
--   run_stop_events    arrive / leave per stop -- the raw material for ETAs,
--                      dwell time and "how long does this customer take".
--   delivery_attempts  one row per attempt, delivered or failed, carrying the
--                      failure reason, what to do next, and the proof of
--                      delivery (name, signature, photo, cash).
--   delivery-pod       storage bucket for the door photo. Private: it shows
--                      the inside of a customer's premises.
--
-- Both tables are append-only history: the app never updates or deletes a row,
-- and no RLS write policy exists for either. Everything goes through the
-- driver_* RPCs, which is the same shape as the rest of the order pipeline.
--
-- A failed attempt does NOT cancel the order. Cancelling is a commercial
-- decision the office makes; the driver only reports what happened at the door.

begin;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'stop_event_kind') then
    create type public.stop_event_kind as enum ('arrive', 'leave');
  end if;
  if not exists (select 1 from pg_type where typname = 'delivery_outcome') then
    create type public.delivery_outcome as enum ('delivered', 'failed');
  end if;
  if not exists (select 1 from pg_type where typname = 'delivery_failure_reason') then
    create type public.delivery_failure_reason as enum (
      'shop_closed', 'rejected', 'no_cash', 'wrong_address', 'other'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'delivery_next_action') then
    create type public.delivery_next_action as enum (
      'retry_today', 'move_tomorrow', 'return_to_yard'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- run_stop_events
-- ---------------------------------------------------------------------------
create table if not exists public.run_stop_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null references public.delivery_runs(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  kind public.stop_event_kind not null,
  at timestamptz not null default now(),
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists run_stop_events_run_idx on public.run_stop_events(run_id, at);
create index if not exists run_stop_events_order_idx on public.run_stop_events(order_id, at);

comment on table public.run_stop_events is
  'Append-only arrive/leave marks per stop. Source of ETA, dwell time and lateness.';

-- ---------------------------------------------------------------------------
-- delivery_attempts
-- ---------------------------------------------------------------------------
create table if not exists public.delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null references public.delivery_runs(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  outcome public.delivery_outcome not null,
  reason public.delivery_failure_reason null,
  next_action public.delivery_next_action null,
  note text null check (char_length(note) <= 500),
  -- Proof of delivery. Every field is optional: a regular wholesale drop that
  -- the customer already trusts should not need three taps of ceremony.
  received_by text null check (char_length(received_by) <= 120),
  signature_path text null,
  photo_path text null,
  cash_collected numeric(12, 2) null check (cash_collected >= 0),
  attempted_at timestamptz not null default now(),
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  -- A failure has to say why; a delivery has nothing to explain.
  constraint delivery_attempts_reason_shape check (
    (outcome = 'failed' and reason is not null)
    or (outcome = 'delivered' and reason is null and next_action is null)
  )
);

create index if not exists delivery_attempts_run_idx on public.delivery_attempts(run_id, attempted_at);
create index if not exists delivery_attempts_order_idx on public.delivery_attempts(order_id, attempted_at);

comment on table public.delivery_attempts is
  'Append-only record of every attempt at a stop, delivered or failed, with its proof of delivery.';

-- ---------------------------------------------------------------------------
-- RLS: office reads its org, driver reads their own run. No write policies --
-- every insert goes through the driver_* RPCs below.
-- ---------------------------------------------------------------------------
alter table public.run_stop_events enable row level security;
alter table public.delivery_attempts enable row level security;

create policy "run_stop_events_select_member" on public.run_stop_events
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
        and (expires_at is null or expires_at > now())
        and role <> 'driver'
    )
  );

create policy "run_stop_events_select_driver" on public.run_stop_events
  for select to authenticated using (run_id in (select public.driver_run_ids()));

create policy "delivery_attempts_select_member" on public.delivery_attempts
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active'
        and (expires_at is null or expires_at > now())
        and role <> 'driver'
    )
  );

create policy "delivery_attempts_select_driver" on public.delivery_attempts
  for select to authenticated using (run_id in (select public.driver_run_ids()));

grant select on public.run_stop_events, public.delivery_attempts to authenticated;

-- ---------------------------------------------------------------------------
-- Who may record at a stop: the driver of that run, or the office.
--
-- The office is included on purpose -- a driver whose phone is flat still has
-- to be able to phone the drop in, and the audit trail then honestly says the
-- office recorded it (recorded_by).
-- ---------------------------------------------------------------------------
create or replace function public.can_record_stop(p_run uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    exists (select 1 from public.delivery_runs where id = p_run and driver_id = (select auth.uid()))
    or public.has_org_role(p_org, array['owner', 'org_admin', 'seller', 'logistics']);
$$;

revoke all on function public.can_record_stop(uuid, uuid) from public;
grant execute on function public.can_record_stop(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- driver_arrive_stop: the truck is at the door.
--
-- Re-firing is a no-op rather than an error: a driver who taps twice, or
-- whose queued offline event arrives late, should not see a failure.
-- ---------------------------------------------------------------------------
create or replace function public.driver_arrive_stop(p_order uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_run uuid;
  v_run_status public.delivery_run_status;
begin
  select o.organization_id, o.run_id into v_org, v_run
  from public.orders o where o.id = p_order for update;

  if v_org is null or v_run is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.can_record_stop(v_run, v_org) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  select status into v_run_status from public.delivery_runs where id = v_run;
  if v_run_status = 'planned' then
    raise exception using errcode = 'P0001', message = 'run_not_departed';
  end if;

  -- Already standing here: the last thing recorded at this stop was an
  -- arrive with no leave after it.
  if (
    select kind from public.run_stop_events
    where order_id = p_order
    order by at desc, created_at desc
    limit 1
  ) = 'arrive' then
    return;
  end if;

  insert into public.run_stop_events (organization_id, run_id, order_id, kind, recorded_by)
  values (v_org, v_run, p_order, 'arrive', auth.uid());
end;
$$;

revoke all on function public.driver_arrive_stop(uuid) from public;
grant execute on function public.driver_arrive_stop(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- driver_deliver_stop: goods handed over.
--
-- Writes the leave mark, the attempt with its proof, and moves the order to
-- 'delivered' -- the same transition set_run_status makes when a run closes,
-- so settlement downstream is unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.driver_deliver_stop(
  p_order uuid,
  p_received_by text default null,
  p_signature_path text default null,
  p_photo_path text default null,
  p_cash_collected numeric default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_run uuid;
  v_status public.order_status;
begin
  select o.organization_id, o.run_id, o.status into v_org, v_run, v_status
  from public.orders o where o.id = p_order for update;

  if v_org is null or v_run is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.can_record_stop(v_run, v_org) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  -- Delivering the same stop twice is a no-op, not an error: the driver's
  -- phone may retry a queued write after the office already recorded it.
  if v_status in ('delivered', 'closed') then
    return;
  end if;

  if v_status <> 'ready' then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  if p_cash_collected is not null and p_cash_collected < 0 then
    raise exception using errcode = 'P0001', message = 'invalid_amount';
  end if;

  insert into public.run_stop_events (organization_id, run_id, order_id, kind, recorded_by)
  values (v_org, v_run, p_order, 'leave', auth.uid());

  insert into public.delivery_attempts (
    organization_id, run_id, order_id, outcome,
    received_by, signature_path, photo_path, cash_collected, recorded_by
  )
  values (
    v_org, v_run, p_order, 'delivered',
    nullif(btrim(coalesce(p_received_by, '')), ''), p_signature_path, p_photo_path,
    p_cash_collected, auth.uid()
  );

  update public.orders set status = 'delivered' where id = p_order;
end;
$$;

revoke all on function public.driver_deliver_stop(uuid, text, text, text, numeric) from public;
grant execute on function public.driver_deliver_stop(uuid, text, text, text, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- driver_fail_stop: nobody there, goods refused, no cash, wrong address.
--
-- The order keeps its status. It is still owed to the customer; only the
-- office can decide to cancel it or move it to another day.
-- ---------------------------------------------------------------------------
create or replace function public.driver_fail_stop(
  p_order uuid,
  p_reason public.delivery_failure_reason,
  p_next_action public.delivery_next_action default null,
  p_note text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_run uuid;
  v_status public.order_status;
begin
  select o.organization_id, o.run_id, o.status into v_org, v_run, v_status
  from public.orders o where o.id = p_order for update;

  if v_org is null or v_run is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.can_record_stop(v_run, v_org) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_status in ('delivered', 'closed', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  insert into public.run_stop_events (organization_id, run_id, order_id, kind, recorded_by)
  values (v_org, v_run, p_order, 'leave', auth.uid());

  insert into public.delivery_attempts (
    organization_id, run_id, order_id, outcome, reason, next_action, note, recorded_by
  )
  values (
    v_org, v_run, p_order, 'failed', p_reason, p_next_action,
    nullif(btrim(coalesce(p_note, '')), ''), auth.uid()
  );
end;
$$;

revoke all on function public.driver_fail_stop(uuid, public.delivery_failure_reason, public.delivery_next_action, text) from public;
grant execute on function public.driver_fail_stop(uuid, public.delivery_failure_reason, public.delivery_next_action, text) to authenticated;

-- ---------------------------------------------------------------------------
-- delivery-pod storage bucket.
--
-- Private, unlike product-images: these photos show the inside of a
-- customer's premises. Object names are '{organization_id}/{run_id}/{uuid}.jpg'.
-- Drivers may add a file to their own run's folder and read it back; the
-- office reads its whole org. Nobody updates or deletes -- proof that can be
-- swapped after the fact is not proof.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'delivery-pod',
  'delivery-pod',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "delivery_pod_member_read" on storage.objects;
create policy "delivery_pod_member_read" on storage.objects
  for select to authenticated using (
    bucket_id = 'delivery-pod'
    and (storage.foldername(name))[1] in (
      select organization_id::text from public.organization_members
      where user_id = auth.uid() and status = 'active' and role <> 'driver'
    )
  );

drop policy if exists "delivery_pod_driver_read" on storage.objects;
create policy "delivery_pod_driver_read" on storage.objects
  for select to authenticated using (
    bucket_id = 'delivery-pod'
    and (storage.foldername(name))[2] in (select public.driver_run_ids()::text)
  );

drop policy if exists "delivery_pod_write" on storage.objects;
create policy "delivery_pod_write" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'delivery-pod'
    and (
      (storage.foldername(name))[2] in (select public.driver_run_ids()::text)
      or (storage.foldername(name))[1] in (
        select organization_id::text from public.organization_members
        where user_id = auth.uid() and status = 'active'
          and role in ('owner', 'org_admin', 'seller', 'logistics')
      )
    )
  );

commit;
