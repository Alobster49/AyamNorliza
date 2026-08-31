-- Narrow what an anonymous visitor can read from `organizations`, and index
-- the leave-credit lookups.
--
-- ## Anonymous org read
--
-- `organizations_select_public` is `for select using (true)` and `anon` holds
-- a table-wide SELECT, so every column is world-readable. That was fine when
-- the table held slug/name/region for the buyer portal's shop page. It is not
-- fine since 20260828000001 added the invoice letterhead: `registration_no`,
-- `address`, `phone` and `email` are now public, along with the internal
-- `created_by` / `updated_by` user ids and the `version` counter.
--
-- The policy stays as it is -- the row genuinely is public -- and the column
-- list is narrowed with a column-level grant instead, which is the mechanism
-- that actually expresses "these columns, not those". Buyer-facing code reads
-- only `id, name, slug, region` (src/features/buyer/server/actions.ts and the
-- portal auth paths), so the granted set is that plus the locale/timezone/
-- status fields a public page may legitimately need to render itself.
--
-- `authenticated` is deliberately untouched: staff need the letterhead to
-- render invoices, and signed-in buyers already receive those details on the
-- invoices they are sent.
--
-- ## leave_credit_requests index
--
-- The table has only its primary key. Its sibling `leave_requests` was given
-- both an (organization_id, user_id) and an (organization_id, status) index in
-- 20260830000001; the credit table gets the same treatment, since the approver
-- queue filters on exactly those.

begin;

-- ---------------------------------------------------------------------------
-- 1. Column-level read for anonymous visitors.
-- ---------------------------------------------------------------------------
revoke select on public.organizations from anon;
grant select (
  id,
  slug,
  name,
  region,
  default_time_zone,
  default_locale,
  status
) on public.organizations to anon;

comment on table public.organizations is
  'Organizations. Anonymous visitors may read only the public identity columns (see the column-level grant in 20260901000013); the invoice letterhead fields — registration_no, address, phone, email — are for authenticated members.';

-- ---------------------------------------------------------------------------
-- 2. Approver-queue indexes, matching leave_requests.
-- ---------------------------------------------------------------------------
create index if not exists leave_credit_requests_org_user_idx
  on public.leave_credit_requests (organization_id, user_id);

create index if not exists leave_credit_requests_org_status_idx
  on public.leave_credit_requests (organization_id, status);

commit;
