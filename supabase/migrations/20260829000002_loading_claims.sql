-- Loading claims: several workers load trucks at once, and the only signal
-- an order was taken used to be the final "loaded" tap — minutes after the
-- worker physically walked off with the crates. Two workers could pick the
-- same order, and dispatch_set_loaded would silently re-load it (overwriting
-- loaded_by), so the duplication never surfaced.
--
-- Three changes:
--  * orders grows loading_claimed_by/loading_claimed_at — an advisory
--    "worker X is carrying this now" lock with a 10-minute TTL. An expired
--    claim counts as no claim everywhere.
--  * dispatch_claim_loading(p_order, p_claim) takes or releases the claim
--    atomically (row locked for update; loser gets claimed_by_other).
--    Release is open to any dispatch role so a walked-away worker's claim
--    can be cleared without waiting out the TTL.
--  * dispatch_set_loaded refuses to load an already-loaded order
--    (already_loaded) or one actively claimed by someone else
--    (claimed_by_other), and clears the claim on every successful write.
--
-- orders also joins the supabase_realtime publication so open loading
-- screens hear each other's writes; RLS select policies already scope the
-- events to org members.

begin;

alter table public.orders
  add column if not exists loading_claimed_by uuid references auth.users (id) on delete set null,
  add column if not exists loading_claimed_at timestamptz;

comment on column public.orders.loading_claimed_by is
  'Advisory loading lock: the worker currently carrying this order to the truck. Expires 10 minutes after loading_claimed_at.';

create or replace function public.dispatch_claim_loading(p_order uuid, p_claim boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_status public.order_status;
  v_run uuid;
  v_run_status public.delivery_run_status;
  v_loaded_at timestamptz;
  v_claimed_by uuid;
  v_claimed_at timestamptz;
begin
  select organization_id, status, run_id, loaded_at, loading_claimed_by, loading_claimed_at
  into v_org, v_status, v_run, v_loaded_at, v_claimed_by, v_claimed_at
  from public.orders where id = p_order for update;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.has_org_role(v_org, array['owner', 'org_admin', 'seller', 'logistics']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if not p_claim then
    -- Release is deliberately open to any dispatch role, not just the
    -- claimer: it is how a stuck claim gets cleared before the TTL runs out.
    update public.orders
    set loading_claimed_by = null, loading_claimed_at = null
    where id = p_order;
    return;
  end if;

  if v_run is null then
    raise exception using errcode = 'P0001', message = 'not_assigned';
  end if;

  select status into v_run_status from public.delivery_runs where id = v_run;
  if v_run_status = 'departed' then
    raise exception using errcode = 'P0001', message = 'run_departed';
  end if;

  if v_loaded_at is not null then
    raise exception using errcode = 'P0001', message = 'already_loaded';
  end if;

  if v_status <> 'ready' then
    raise exception using errcode = 'P0001', message = 'not_weighed';
  end if;

  -- Free means: never claimed, claim expired, or already mine (re-claim
  -- refreshes the timestamp).
  if v_claimed_by is not null
     and v_claimed_by <> auth.uid()
     and v_claimed_at > now() - interval '10 minutes' then
    raise exception using errcode = 'P0001', message = 'claimed_by_other';
  end if;

  update public.orders
  set loading_claimed_by = auth.uid(), loading_claimed_at = now()
  where id = p_order;
end;
$$;

revoke all on function public.dispatch_claim_loading(uuid, boolean) from public;
grant execute on function public.dispatch_claim_loading(uuid, boolean) to authenticated;

create or replace function public.dispatch_set_loaded(p_order uuid, p_loaded boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_status public.order_status;
  v_run uuid;
  v_run_status public.delivery_run_status;
  v_loaded_at timestamptz;
  v_claimed_by uuid;
  v_claimed_at timestamptz;
begin
  select organization_id, status, run_id, loaded_at, loading_claimed_by, loading_claimed_at
  into v_org, v_status, v_run, v_loaded_at, v_claimed_by, v_claimed_at
  from public.orders where id = p_order for update;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.has_org_role(v_org, array['owner', 'org_admin', 'seller', 'logistics']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_status not in ('confirmed', 'ready') then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  if v_run is not null then
    select status into v_run_status from public.delivery_runs where id = v_run;
    if v_run_status = 'departed' then
      raise exception using errcode = 'P0001', message = 'run_departed';
    end if;
  end if;

  if p_loaded and v_run is null then
    raise exception using errcode = 'P0001', message = 'not_assigned';
  end if;

  -- 'ready' is set only by complete_order_task, after every non-cancelled
  -- line has a recorded weight -- so this is the "fully weighed" gate.
  if p_loaded and v_status <> 'ready' then
    raise exception using errcode = 'P0001', message = 'not_weighed';
  end if;

  -- A second worker loading the same order used to silently overwrite
  -- loaded_by; now the stale screen gets told and refetches.
  if p_loaded and v_loaded_at is not null then
    raise exception using errcode = 'P0001', message = 'already_loaded';
  end if;

  if p_loaded
     and v_claimed_by is not null
     and v_claimed_by <> auth.uid()
     and v_claimed_at > now() - interval '10 minutes' then
    raise exception using errcode = 'P0001', message = 'claimed_by_other';
  end if;

  update public.orders
  set loaded_at = case when p_loaded then now() else null end,
      loaded_by = case when p_loaded then auth.uid() else null end,
      loading_claimed_by = null,
      loading_claimed_at = null
  where id = p_order;
end;
$$;

revoke all on function public.dispatch_set_loaded(uuid, boolean) from public;
grant execute on function public.dispatch_set_loaded(uuid, boolean) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end;
$$;

commit;
