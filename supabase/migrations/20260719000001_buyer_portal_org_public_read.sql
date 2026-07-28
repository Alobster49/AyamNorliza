-- 20260719000001_buyer_portal_org_public_read.sql
-- Allow public read access to organizations for buyer portal browsing.

begin;

-- Add public read policy for organizations (needed for buyer portal)
create policy "organizations_select_public" on public.organizations
  for select using (true);

-- Verify the policy was created
select polname, polcmd from pg_policy where polrelid = 'public.organizations'::regclass;

commit;
