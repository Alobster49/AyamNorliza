-- 20260828000001_org_invoice_details.sql
-- Organizations gain the letterhead fields a proper Malaysian invoice carries:
-- SSM registration number, business address, phone and email. All nullable on
-- purpose -- the invoice simply hides whichever line the office has not filled
-- in yet, so existing orgs keep printing invoices unchanged until they do.

begin;

alter table public.organizations
  add column if not exists registration_no text null
    check (registration_no is null or char_length(registration_no) between 3 and 50),
  add column if not exists address text null
    check (address is null or char_length(address) between 3 and 400),
  add column if not exists phone text null
    check (phone is null or char_length(phone) between 3 and 32),
  add column if not exists email text null
    check (email is null or char_length(email) between 3 and 254);

comment on column public.organizations.registration_no is
  'SSM business registration number printed on invoice letterheads, e.g. 202303123456 (003456789-K).';
comment on column public.organizations.address is
  'Business address printed on invoice letterheads.';
comment on column public.organizations.phone is
  'Contact phone printed on invoice letterheads.';
comment on column public.organizations.email is
  'Contact email printed on invoice letterheads.';

commit;
