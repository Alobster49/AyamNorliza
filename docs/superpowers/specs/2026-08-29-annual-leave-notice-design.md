# Advance-notice rule for annual leave

Date: 2026-08-29
Status: implemented

## Rule

Annual leave must start at least **7 calendar days** after the org's today.
Applying on 29 Aug means the earliest start date is 5 Sep. The boundary is
inclusive — exactly 7 days out is accepted.

Only annual leave is gated. Medical, hospitalization, emergency, paternity
and unpaid leave are unplanned by nature and require no notice.

The rule is absolute: no role, HR and owner included, may submit short-notice
annual leave. The escape hatch for a genuine emergency is an emergency-leave
request, which carries no notice requirement.

Calendar days, not workdays — "one week ahead" is how a member reads it, and
a workday cutoff would drift silently with public holidays.

## Where it is enforced

Three layers, deliberately. The first two are the same check; the third is
the backstop that makes the rule real.

1. **`apply-leave-dialog.tsx`** — `min` on the start-date input (so the
   picker greys out barred days) plus an inline error and a hint naming the
   earliest allowed date. Convenience only.
2. **`applyLeave` in `leave-actions.ts`** — `validateApplication` now takes
   the org's `today` (from `todayInTimeZone(guard.timeZone)`) and returns a
   new `insufficient_notice` reason. This is what a caller who skips the UI
   hits.
3. **`leave_requests` BEFORE INSERT trigger**
   (`20260830000004_hr_leave_notice.sql`) — `applyLeave` is a plain insert,
   so without this a member can POST straight to PostgREST and book annual
   leave for tomorrow. Same reasoning as the `day_count` recompute added in
   `20260830000003`.

`MIN_NOTICE_DAYS_BY_CODE` in `leave-model.ts` and `leave_min_notice_days` in
SQL are twins; divergence between them is a bug.

## Time zone

Both the action and the trigger resolve "today" in the **org's** time zone,
never the server's and never Postgres `current_date`. Postgres runs in UTC
and the depot runs on Malaysian time, so between 00:00 and 08:00 MYT
`current_date` is still yesterday and the cutoff would be a day too lenient.
The trigger reads `organizations.default_time_zone`, mirroring
`todayInTimeZone` in `src/lib/time/org-date.ts`.

Because the two checks read the clock at slightly different moments, the
trigger can reject a request the action just accepted, if the depot clock
rolls past midnight in between. `applyLeave` maps that insert error back to
`hr.errors.insufficient_notice` rather than a generic failure.

## Rejection ordering

`validateApplication` reports notice **before** balance, so a short-notice
request that is also over-balance names the date problem — the one the member
can actually act on today.

## Not done

- No `min_notice_days` column on `leave_types`. HR cannot tune the 7 days
  without a deploy. Considered and rejected as premature: it costs a
  migration, regenerated DB types, and new settings UI for a value the
  business states as fixed. Revisit if HR asks to change it.
- Approval is unaffected. Notice is an apply-time rule; re-checking it at
  approval would be meaningless, since time has passed by then.

## Testing

- `leave-model.test.ts` — 7 cases: notice-by-code, calendar-day arithmetic,
  inside-window rejection, inclusive boundary, past dates, unplanned types
  ungated, notice-before-balance ordering.
- `leave-actions-message-keys.test.ts` — 4 cases at the Server Action layer,
  with the clock frozen at 2026-08-10 so the fixtures cannot drift into the
  window as the real date advances.
- DB trigger verified by hand against the local database: annual at 3 days'
  notice refused with `insufficient_notice`, annual at 9 days accepted,
  medical at 3 days accepted.
