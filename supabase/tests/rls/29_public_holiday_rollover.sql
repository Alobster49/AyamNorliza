-- supabase/tests/rls/29_public_holiday_rollover.sql
-- Coverage for 20260901000011_public_holiday_rollover.sql.
--
-- `leave_workday_count` counts Mon-Fri minus rows in `public_holidays`, and
-- those rows were inserted once, for 2026 only, by a backfill in
-- 20260830000001. Two silent failures follow from that:
--
--   * From 1 January 2027 every weekday counts as a workday, so leave
--     deducts more days than it should. Nothing raises; balances are just
--     quietly wrong, which is the worst way for a leave system to fail.
--   * The backfill was a one-off `select ... from organizations`, so an
--     organization created afterwards has no holidays at all and is already
--     counting wrongly today.
--
-- Dates for a future year cannot be derived: half the Malaysian calendar is
-- lunar or Islamic and the gazetted dates are proclamations, so they have to
-- be entered rather than guessed. What this migration can do is refuse to
-- answer for a year nobody has configured, which turns a wrong number into a
-- visible error an HR admin can act on through the existing holiday editor.

begin;

select plan(6);

insert into public.organizations (id, slug, name)
values ('da000000-0000-0000-0000-00000000000a', 'holiday-rollover-org', 'Holiday Rollover Org')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 1: a new organization inherits the national calendar, rather than starting
--    with nothing and counting every public holiday as a workday.
-- ---------------------------------------------------------------------------
select ok(
  (select count(*) from public.public_holidays
    where organization_id = 'da000000-0000-0000-0000-00000000000a') > 0,
  'a newly created organization is seeded with public holidays');

-- ---------------------------------------------------------------------------
-- 2-3: a configured year still counts the way it always did.
-- ---------------------------------------------------------------------------
-- 2026-08-31 (Merdeka) is a seeded Monday holiday.
select is(
  public.leave_workday_count('da000000-0000-0000-0000-00000000000a', '2026-08-31', '2026-08-31'),
  0::numeric,
  'a seeded public holiday is not a workday');

-- Mon 2026-08-31 .. Fri 2026-09-04: five weekdays, one of them Merdeka.
select is(
  public.leave_workday_count('da000000-0000-0000-0000-00000000000a', '2026-08-31', '2026-09-04'),
  4::numeric,
  'the holiday is subtracted from an otherwise full working week');

-- ---------------------------------------------------------------------------
-- 4-5: an unconfigured year refuses to answer instead of over-counting.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.leave_workday_count('da000000-0000-0000-0000-00000000000a', '2027-03-01', '2027-03-05') $$,
  'P0001',
  'holidays_not_configured',
  'a year with no configured holidays raises rather than counting every weekday');

-- The dangerous case: a range that starts in a configured year and runs into
-- an unconfigured one would otherwise return a plausible-looking number.
select throws_ok(
  $$ select public.leave_workday_count('da000000-0000-0000-0000-00000000000a', '2026-12-28', '2027-01-08') $$,
  'P0001',
  'holidays_not_configured',
  'a range spanning into an unconfigured year raises too');

-- ---------------------------------------------------------------------------
-- 6: configuring the year clears the refusal, so HR can unblock itself
--    through the existing holiday editor.
-- ---------------------------------------------------------------------------
insert into public.public_holidays (organization_id, holiday_date, name)
values ('da000000-0000-0000-0000-00000000000a', '2027-01-01', 'New Year''s Day')
on conflict do nothing;

select is(
  public.leave_workday_count('da000000-0000-0000-0000-00000000000a', '2027-01-01', '2027-01-01'),
  0::numeric,
  'once the year has holidays the count works again');

select * from finish();
rollback;
