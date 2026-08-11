-- 20260710000001_create_owner_account.sql
--
-- NO-OP. This migration previously created a real auth login
-- (owner@gmail.com) with its password committed to this repository, and it
-- was applied to the hosted project, so the credential was live.
--
-- The account's password has been rotated out-of-band on the hosted project.
-- The local development/e2e equivalent now lives in supabase/seed.sql, which
-- `supabase db reset` runs and `supabase db push` never does.
--
-- The file is kept (rather than deleted) because the version is already
-- recorded in the remote migration history; removing it would desynchronise
-- `supabase migration list`.
--
-- Rule: auth fixtures belong in supabase/seed.sql. Never in a migration.

select 1;
