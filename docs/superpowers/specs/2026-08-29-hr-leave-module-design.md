# HR Leave Module — Design

**Date:** 2026-08-29 · **Branch:** `feature/hr-leave` (worktree, off local main 6ea426d)
**Decisions:** full entitlement engine · approvers = hr/owner/org_admin · DB-driven leave types · leave-focused all-staff view · monthly pro-rata accrual · workdays-minus-holidays counting · Supabase-storage attachments · capped carry-forward with expiry · hybrid TS model + SQL guard.

## Goal

Any org member (every role, drivers included) can apply for leave and see balances.
New `hr` role manages approvals via its own dashboard. All-staff view shows who's
away and upcoming Malaysian public holidays. UI modeled on the five reference
screenshots (leave entitlement page, history table, apply dialog, credit dialog,
home who's-away panel) using the existing shadcn kit.

## 1. Role & gating

- Migration extends `organization_members.role` CHECK with `hr`; `hr` added to
  `ROLES` in `src/lib/auth/permissions.ts`.
- Seed login `hr@gmail.com` / `password123`; added to
  `src/features/data-console/lib/accounts.ts` and the dev pick-account dialog.
- Routes live under `(seller)/[organizationSlug]/leave/*`. The shell layout
  currently redirects non-STAFF_ROLES; leave routes are gated to **any org
  member** instead. `/leave/manage` requires `hr | owner | org_admin`.
- Sidebar: new "HR" group — *My Leave* (all members), *Leave Management*
  (hr/owner/org_admin only).

## 2. Data model (one migration; org-scoped; RLS via `auth.uid()` membership checks; explicit grants — see §6)

- **leave_types** — org_id, code, name, entitlement_days `numeric` (NULL =
  upon-request), accrual `'pro_rata' | 'full'`, carry_forward_cap `numeric`
  (NULL = no carry), requires_attachment bool, sort. Seeded per org:
  Annual 12 (pro_rata, cap 6), Medical 14, Hospitalization 60, Paternity 7
  (all `full`), Emergency + Unpaid upon-request. HR-editable.
- **leave_ledger** — org_id, user_id, leave_type_id, year, kind
  `'carry_forward' | 'credit' | 'adjustment'`, days, expires_on date NULL,
  note, created_by. Carry-forward is a ledger row expiring 31 Oct.
- **leave_requests** — org_id, user_id, leave_type_id, year, start_date,
  end_date, day_count, justification, attachment_path, status
  `'pending' | 'approved' | 'rejected' | 'cancelled'`, decided_by, decided_at,
  decision_note, breakdown jsonb (`{carry_forward_used, base_used}` written at
  approval).
- **leave_credit_requests** — org_id, user_id, credit_type (`'replacement'`),
  amount, reference_start, reference_end, justification, attachment_path,
  status + decision fields. Approval inserts a `leave_ledger` credit row.
- **public_holidays** — org_id, holiday_date, name. Seeded MY 2026;
  HR-editable.
- **Storage** — private bucket `leave-attachments`; path
  `org/<org_id>/<user_id>/...`; owner read/write own, approver roles read.

## 3. Engine (hybrid)

Pure TS `src/features/hr/lib/leave-model.ts` (pattern: `weigh-model.ts`),
unit-tested, drives all UI numbers:

- `accruedDays(entitlement, asOf)` — entitlement/12 × completed months of the
  year (pro_rata); full types return entitlement from 1 Jan.
- `workdayCount(start, end, holidays)` — Mon–Fri minus public holidays.
- `computeBalance(type, ledgerRows, requests, asOf)` →
  `{carryForward, accrued, taken: {base, carryForward}, pending, available}`.
  Deductions consume unexpired carry-forward first, then base. Pending
  requests hold balance (shown, and blocked from over-applying).

SQL RPCs (SECURITY DEFINER, role-checked, `grant execute`):

- `approve_leave_request(id, note)` — row-lock, recompute server-side,
  carry-forward-first split into `breakdown`, set approved. Atomic; two
  concurrent approvals cannot overspend.
- `reject_leave_request(id, note)`; `cancel_leave_request(id)` (own, pending).
- `approve_leave_credit(id, note)` / `reject_leave_credit(id, note)`.
- `close_leave_year(year)` — HR button: per user, unused annual →
  min(unused, cap) carry-forward ledger rows for year+1, expires 31 Oct.
  Idempotent (skips users already closed).

## 4. Pages (shadcn)

- **`/leave` — My Leave**: entitlement header card (carry forward + accrued −
  taken = available, as-of selector), policy cards per type, **Apply Leave**
  dialog (type radio list with live remaining, date range, justification,
  attachment), **Request Leave Credit** dialog, history table (year / type /
  status filters, status badges, decision note), *Who's away* panel (approved
  leave, today/upcoming) + next public holidays.
- **`/leave/manage` — HR dashboard**: pending queue (leave + credit requests;
  approve/reject with note, attachment preview), staff balances table, tabs:
  Holidays editor · Leave-type settings · Year-close.

## 5. i18n

New `hr` namespace in `src/messages/en.json` + `ms.json` (regenerate
`en.d.json.ts`). All user-visible strings translated; e2e specs select by
label, so specs written against final English copy.

## 6. Known repo gotchas honored

- Every new table: explicit `grant select/insert/update/delete to
  authenticated`; every RPC: `grant execute` (RLS alone → 42501).
- Worktree dev server: Turbopack root must be pinned or server started via
  Bash (preview_start's launch.json resolves against main checkout).
- No `git stash`, no `git checkout <path>` in shared tree.

## 7. Testing

- Unit: leave-model — accrual month math, workday count across holidays and
  weekends, carry-forward-first split, expiry cutoff, pending holds,
  year-close cap.
- e2e (`e2e/hr-leave.spec.ts`): worker applies → hr approves → balance drops
  and history shows APPROVED; reject path keeps balance.

## 8. Out of scope (v1)

Claims/payroll/birthdays/feed (screenshot 5 extras), multi-step approval
chains, email notifications, half-days, prod deploy (recorded in
prod-deploy-debt afterwards).
