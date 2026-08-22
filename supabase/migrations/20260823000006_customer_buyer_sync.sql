-- Customer–buyer sync: buyers get a linked customers row at signup.
-- Spec: docs/superpowers/specs/2026-08-23-customer-buyer-sync-design.md

-- ---------------------------------------------------------------------------
-- normalize_phone: mirrors normalizeMalaysianMobile in
-- src/features/buyer-auth/lib/phone.ts (strip non-digits; leading country
-- code 60 collapses to national 0). Immutable so it can back a generated
-- column. Changing this function does NOT recompute stored values.
-- ---------------------------------------------------------------------------
create or replace function public.normalize_phone(p_raw text)
returns text
language sql
immutable
as $$
  select case
    when d.digits like '60%' and length(d.digits) >= 10
      then '0' || regexp_replace(substr(d.digits, 3), '^0', '')
    else d.digits
  end
  from (select regexp_replace(coalesce(p_raw, ''), '[^0-9]', '', 'g') as digits) d
$$;

-- ---------------------------------------------------------------------------
-- customers: email + normalized phone
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists email text null
    check (email is null or char_length(email) <= 254);

alter table public.customers
  add column if not exists phone_normalized text
    generated always as (public.normalize_phone(phone)) stored;

create index if not exists customers_org_phone_norm_idx
  on public.customers(organization_id, phone_normalized);

comment on column public.customers.email is
  'Contact email. Filled from auth.users at buyer link time when null; portal invite flow is a future feature.';

-- ---------------------------------------------------------------------------
-- Shared link-or-create logic (used by the signup trigger and the backfill).
-- ---------------------------------------------------------------------------
create or replace function public.link_or_create_customer_for_buyer(p_buyer_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_buyer record;
  v_email text;
  v_norm text;
  v_customer_id uuid;
begin
  select b.id, b.organization_id, b.display_name, b.phone, b.customer_id
    into v_buyer
  from public.buyers b
  where b.id = p_buyer_id;

  if not found or v_buyer.customer_id is not null then
    return;
  end if;

  select u.email into v_email from auth.users u where u.id = p_buyer_id;
  v_norm := public.normalize_phone(v_buyer.phone);

  if v_norm <> '' then
    -- Oldest unclaimed phone match in the same org wins; claimed rows are
    -- never re-linked (no stealing).
    select c.id
      into v_customer_id
    from public.customers c
    where c.organization_id = v_buyer.organization_id
      and c.phone_normalized = v_norm
      and not exists (select 1 from public.buyers b2 where b2.customer_id = c.id)
    order by c.created_at asc
    limit 1;
  end if;

  if v_customer_id is null then
    insert into public.customers (organization_id, name, phone, email, created_by)
    values (v_buyer.organization_id, v_buyer.display_name,
            coalesce(v_buyer.phone, '-----'), v_email, p_buyer_id)
    returning id into v_customer_id;
  else
    -- Seller-entered fields win; only a null email is filled.
    update public.customers
      set email = coalesce(email, v_email)
    where id = v_customer_id;
  end if;

  update public.buyers set customer_id = v_customer_id where id = p_buyer_id;
end;
$$;

revoke execute on function public.link_or_create_customer_for_buyer(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Signup trigger
-- ---------------------------------------------------------------------------
create or replace function public.buyers_sync_customer_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.link_or_create_customer_for_buyer(new.id);
  return new;
end;
$$;

revoke execute on function public.buyers_sync_customer_trigger()
  from public, anon, authenticated;

drop trigger if exists buyers_sync_customer on public.buyers;
create trigger buyers_sync_customer
  after insert on public.buyers
  for each row execute function public.buyers_sync_customer_trigger();

-- ---------------------------------------------------------------------------
-- Backfill: link every pre-existing buyer, then fill missing emails on
-- already-linked customers. Idempotent.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select id from public.buyers where customer_id is null loop
    perform public.link_or_create_customer_for_buyer(r.id);
  end loop;
end $$;

update public.customers c
set email = u.email
from public.buyers b
join auth.users u on u.id = b.id
where b.customer_id = c.id
  and c.email is null
  and u.email is not null;
