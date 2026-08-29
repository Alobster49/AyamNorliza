-- Weigh claims: several workers weigh at once on /tasks, and the only
-- signal a task was taken used to be its completion — minutes after the
-- worker started putting birds on the scale. Every station's default
-- cursor also pointed at the same first task, so collisions were the rule,
-- not the exception. complete_order_task already rejects the second submit
-- (task_done, row locked for update), but only after the loser weighed the
-- whole order.
--
-- Three changes, mirroring 20260829000002_loading_claims.sql:
--  * order_tasks grows weigh_claimed_by/weigh_claimed_at — an advisory
--    "worker X is weighing this now" lock with a 10-minute TTL. An expired
--    claim counts as no claim everywhere.
--  * claim_weigh_task(p_task, p_claim) takes or releases the claim
--    atomically (row locked for update; loser gets claimed_by_other).
--    Release is open to any staff role so a walked-away worker's claim can
--    be cleared without waiting out the TTL.
--  * complete_order_task refuses a task actively claimed by someone else
--    (claimed_by_other) and clears the claim on success.
--
-- order_tasks also joins the supabase_realtime publication so open weigh
-- screens hear each other's claims and completions; RLS select policies
-- already scope the events to org members.

begin;

alter table public.order_tasks
  add column if not exists weigh_claimed_by uuid references auth.users (id) on delete set null,
  add column if not exists weigh_claimed_at timestamptz;

comment on column public.order_tasks.weigh_claimed_by is
  'Advisory weigh lock: the worker currently weighing this task. Expires 10 minutes after weigh_claimed_at.';

create or replace function public.claim_weigh_task(p_task uuid, p_claim boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_task_status public.order_task_status;
  v_order_status public.order_status;
  v_claimed_by uuid;
  v_claimed_at timestamptz;
begin
  select ot.organization_id, ot.status, o.status, ot.weigh_claimed_by, ot.weigh_claimed_at
  into v_org, v_task_status, v_order_status, v_claimed_by, v_claimed_at
  from public.order_tasks ot
  join public.orders o on o.id = ot.order_id
  where ot.id = p_task
  for update of ot;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.has_org_role(v_org, array['owner', 'org_admin', 'seller', 'inventory', 'logistics']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if not p_claim then
    -- Release is deliberately open to any staff role, not just the
    -- claimer: it is how a stuck claim gets cleared before the TTL runs out.
    update public.order_tasks
    set weigh_claimed_by = null, weigh_claimed_at = null
    where id = p_task;
    return;
  end if;

  if v_task_status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'task_done';
  end if;

  if v_order_status <> 'confirmed' then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  -- Free means: never claimed, claim expired, or already mine (re-claim
  -- refreshes the timestamp).
  if v_claimed_by is not null
     and v_claimed_by <> auth.uid()
     and v_claimed_at > now() - interval '10 minutes' then
    raise exception using errcode = 'P0001', message = 'claimed_by_other';
  end if;

  update public.order_tasks
  set weigh_claimed_by = auth.uid(), weigh_claimed_at = now()
  where id = p_task;
end;
$$;

revoke all on function public.claim_weigh_task(uuid, boolean) from public;
grant execute on function public.claim_weigh_task(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- complete_order_task: staff key warehouse weight/pieces per line, mark the
-- task done, move the order to ready.
-- ---------------------------------------------------------------------------
create or replace function public.complete_order_task(p_task uuid, p_weights jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_order_id uuid;
  v_task_status public.order_task_status;
  v_order_status public.order_status;
  v_claimed_by uuid;
  v_claimed_at timestamptz;
  v_item_count integer;
  v_weight jsonb;
  v_item_id uuid;
  v_weight_kg numeric;
  v_pieces integer;
  v_pieces_text text;
  v_seen_ids uuid[] := '{}';
begin
  select ot.organization_id, ot.order_id, ot.status, o.status,
         ot.weigh_claimed_by, ot.weigh_claimed_at
    into v_org, v_order_id, v_task_status, v_order_status,
         v_claimed_by, v_claimed_at
  from public.order_tasks ot
  join public.orders o on o.id = ot.order_id
  where ot.id = p_task
  for update;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  if not public.has_org_role(v_org, array['owner', 'org_admin', 'seller', 'inventory', 'logistics']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_task_status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'task_done';
  end if;

  if v_order_status <> 'confirmed' then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  if v_claimed_by is not null
     and v_claimed_by <> auth.uid()
     and v_claimed_at > now() - interval '10 minutes' then
    raise exception using errcode = 'P0001', message = 'claimed_by_other';
  end if;

  if p_weights is null or jsonb_typeof(p_weights) <> 'array' or jsonb_array_length(p_weights) = 0 then
    raise exception using errcode = 'P0001', message = 'weights_incomplete';
  end if;

  select count(*) into v_item_count
  from public.order_items where order_id = v_order_id and is_cancelled = false;

  -- Validation pass: every weight entry must name a real, distinct,
  -- not-yet-cancelled line on this order with a well-formed item_id and a
  -- positive weight_kg, and every line must be covered, before any row is
  -- touched.
  for v_weight in select * from jsonb_array_elements(p_weights)
  loop
    v_item_id := public._order_safe_uuid(v_weight->>'item_id');

    if v_item_id is null or v_item_id = any(v_seen_ids) then
      raise exception using errcode = 'P0001', message = 'weights_incomplete';
    end if;

    if not exists (
      select 1 from public.order_items
      where id = v_item_id and order_id = v_order_id and is_cancelled = false
    ) then
      raise exception using errcode = 'P0001', message = 'weights_incomplete';
    end if;

    v_seen_ids := array_append(v_seen_ids, v_item_id);

    v_weight_kg := public._order_safe_numeric(v_weight->>'weight_kg');

    if v_weight_kg is null or v_weight_kg <= 0 then
      raise exception using errcode = 'P0001', message = 'invalid_weight';
    end if;

    v_pieces_text := nullif(v_weight->>'pieces', '');

    if v_pieces_text is not null and public._order_safe_integer(v_pieces_text) is null then
      raise exception using errcode = 'P0001', message = 'weights_incomplete';
    end if;
  end loop;

  if coalesce(array_length(v_seen_ids, 1), 0) <> v_item_count then
    raise exception using errcode = 'P0001', message = 'weights_incomplete';
  end if;

  -- Apply pass.
  for v_weight in select * from jsonb_array_elements(p_weights)
  loop
    v_item_id := public._order_safe_uuid(v_weight->>'item_id');
    v_weight_kg := public._order_safe_numeric(v_weight->>'weight_kg');
    v_pieces_text := nullif(v_weight->>'pieces', '');
    v_pieces := case when v_pieces_text is null then null else public._order_safe_integer(v_pieces_text) end;

    update public.order_items
    set warehouse_weight_kg = v_weight_kg, warehouse_pieces = v_pieces
    where id = v_item_id and order_id = v_order_id;

    insert into public.order_weight_log (organization_id, order_item_id, kind, weight_kg, pieces, recorded_by)
    values (v_org, v_item_id, 'warehouse', v_weight_kg, v_pieces, auth.uid());
  end loop;

  update public.order_tasks
  set status = 'done', done_by = auth.uid(), done_at = now(),
      weigh_claimed_by = null,
      weigh_claimed_at = null
  where id = p_task;

  update public.orders set status = 'ready' where id = v_order_id;
end;
$$;

revoke all on function public.complete_order_task(uuid, jsonb) from public;
grant execute on function public.complete_order_task(uuid, jsonb) to authenticated;

-- Live weigh queue: guarded — db reset replays this after the loading
-- migration, and a table can join a publication only once.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_tasks'
  ) then
    alter publication supabase_realtime add table public.order_tasks;
  end if;
end;
$$;

commit;
