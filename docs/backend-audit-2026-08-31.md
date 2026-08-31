# Backend Architecture Audit — 2026-08-31

Deep audit of the backend: 70 Supabase migrations, RLS/RBAC, ~80 SECURITY DEFINER
RPCs, 4 edge functions, and every server action under `src/features/*/server` +
`src/lib/auth`. Four parallel audit passes (schema, security, server layer,
duplication/infra), findings cross-verified.

## Verdict

**The backend is fundamentally sound but sits mid-migration.** The core
architecture — RLS on all 47 tables, mutation-by-RPC with `has_permission()`
guards, a narrow named service-role API, pinned `search_path` on every definer
function — is genuinely good, better than most Supabase apps. The problems are
concentrated in two places:

1. **The dynamic-RBAC migration is ~70% done.** Its own comments reference a
   "Task 13" cleanup that never landed. RLS policies, storage policies, and two
   server-action files still enforce the *old* hardcoded role list, so the new
   Roles & Permissions UI silently lies for those surfaces.
2. **Two server-action files shipped with no auth guards at all**
   (`seller/server/actions.ts`, `market/server/actions.ts`). RLS is the only
   thing protecting them today — and that RLS is the legacy kind that ignores
   dynamic permissions.

Nothing here is an open exploit for the current 7 built-in roles. But **custom
roles are not safe to ship to real users until the items in §1 land.**

> **Status, 2026-09-01 (final).** Every P0 and P1 item is closed, along with
> most of P2 and the delete list. Policies naming a hardcoded role went from
> **59 to 1** (the survivor is `organizations_insert_owner`, which has no
> membership to check at org-creation time). The pgTAP suite went from 16
> failures plus a file that would not parse, to **33 files / 347 tests green**.
> Custom roles are safe to ship.
>
> Fixing the suite was worth more than the green tick: it had been hiding two
> real regressions shipped to production by the RBAC merge, and a third bug
> (an access-review email sent under the invite subject line) surfaced while
> reconciling the duplicated edge-function templates.
>
> Still open, all deliberate — see "What is left" at the end of this document.
>
> One caveat that applies to all of it: the pgTAP suite was **already red on
> `main`** before any of this work — 16 failures across 6 files, plus
> `11_logistics_dispatch.sql`, which does not parse. That baseline was
> confirmed by removing the new migrations and re-running. Fixing it is its own
> task, and it means the SQL suite cannot currently be used as a green gate.

---

## 1. What we need to improve (prioritized)

### P0 — before custom roles reach real users

**1.1 Finish the RBAC migration ("Task 13").** *(Mostly done 2026-09-01 —
`20260901000006_rbac_policy_sweep.sql` + `20260901000007_drop_legacy_capability_overrides.sql`.)*

Policies still naming a hardcoded role went from **59 to 13**, verified by
querying `pg_policies` on a freshly reset local database.

Swept onto `has_permission()`, each mapped to the resource the Server Actions
already guard it with so the two layers agree: catalog (categories, products,
product_variants) → `products`; customers and the staff-side `buyers` read →
`customers`; `market_settings` → `market_prices`; delivery setup (zones,
slots, trucks, truck_zones, schedule_blocks, bays, postcode ranges) →
`delivery_runs`; facilities → `delivery_setup`; and the three storage buckets.

Two things came along for the ride: `has_permission` filters the expiry
window, which the catalog/customer/market policies never did; and UPDATE
policies gained a `WITH CHECK` matching their `USING`, since without one a
permitted update could move a row into another org by rewriting
`organization_id`.

Also dropped: `role_capability_overrides` (table + 4 policies),
both `effective_capabilities` overloads, `role_rank(text)`, and the dead
`src/lib/auth/permissions.server.ts`.

**The 13 still hardcoded, deliberately deferred:**

- The `role <> 'driver'` operational reads on `orders`, `order_items`,
  `delivery_runs`, `delivery_attempts`, `run_stop_events`, plus
  `delivery_pod_member_read`. These mean "any office member", and several
  pages depend on it — the loading board reads `orders`, and a Worker holds
  no `orders:view`. Narrowing them to a single resource grant would break
  the warehouse and loading screens, so they need the app exercised first,
  not just a policy rewrite.
- The admin tables: `audit_log`, `auth_security_events`, `break_glass_events`
  (2), `support_sessions`, `profiles_admin_status_update`. These map to
  ADMIN_CAPABILITIES and are the "capability without effect" case in §2 —
  worth doing, but they change who can read security data.
- `organizations_insert_owner` stays role-based by necessity: the caller has
  no membership yet when creating an org.

Original finding:


`20260901000002_dynamic_rbac_enforcement.sql` rewrote 27 RPCs onto
`has_permission()`, but never touched the RLS policies from earlier migrations.
Still hardcoding `role in ('owner','org_admin','seller',…)`:
- Catalog tables (`20260718000001`), orders/dispatch scheduling
  (`20260810000001`), facilities/bays (`20260814000001`), `market_settings`
  (`20260823000001`), buyers (`20260718120000`).
- `run_stop_events` / `delivery_attempts` SELECT policies check the raw legacy
  `role` column (`20260821000003:109-133`).
- All 3 org storage buckets (`product-images`, `delivery-pod`,
  `leave-attachments`) gate writes on hardcoded role text — a permission revoked
  in the RBAC UI is silently ignored by storage. `delivery_pod_write` still
  references the retired `logistics` role key, so `inventory` workers fail
  closed (functional bug).

Consequence: a custom role granted `products: edit` in the UI gets blocked by
RLS; a built-in role revoked in the UI keeps access. The UI and the database
disagree.

**1.2 Guard `seller/server/actions.ts`.** Every mutation
(create/update/delete category, product, variant, customer) has **zero auth
guard**. The file even defines `requireSellerRole()` (line 28) for exactly this
purpose — it has zero call sites (grep-verified). Mutations filter only
`.eq("id", id)` with no `organization_id` scoping, so cross-org IDOR is blocked
only by legacy RLS. Also 18 sites `throw new Error(error.message)` leaking raw
Postgres text. Fix: replace dead `requireSellerRole` with the shared
`requirePermission()` guard + org-scope every query.

**1.3 Guard `market/server/actions.ts`.** `setMarketState` is a mutation with
no auth check at all — not even `auth.getUser()` — taking a raw client-supplied
`orgId`. Read actions equally bare. Worst file in the audit.

**1.4 Bound `roles.edit` grant power (both layers).** *(Fixed 2026-09-01 —
`20260901000005_bound_role_grants.sql` + `identity-access/server/roles.ts`.)*

Policy chosen: **(a) no broader than your own authority.** Two rules, applied
in RLS and mirrored in the Server Actions so the UI gets a readable message
instead of a bare policy violation:

1. *Self-authority* — a grant may only hand out a `(resource, action)` the
   caller already holds. Revokes are unrestricted; de-escalation is never an
   escalation. This subsumes the app's one-off `data_console.manage` fence:
   owner does not hold that capability, so owner can no longer grant it.
2. *Rank ceiling* — a role editor may only reach roles ranked at or below its
   own, matching what `org_members_update_admin` already does for
   memberships. Covers the role row itself, so a low-ranked editor can no
   longer rename or delete a role above it.

Neither rule changes anything for the seeded roles: org_admin holds every
capability and outranks all but owner.

The escalation was reproduced live before the fix, in
`supabase/tests/rls/26_role_grant_bounds.sql`: a rank-5 custom role holding
only `roles:edit` could grant itself `data_console.manage` and grant
`users:delete`, with **no exception raised**.

One flow needed rework rather than blocking: "reset this system role to its
defaults". Admin's defaults include `data_console.manage`, which an owner
cannot grant, so reset would have failed for the owner. It now runs through a
new `reset_role_to_defaults(uuid)` SECURITY DEFINER RPC that re-seeds from
the same SQL source the org was created with and re-checks `roles:edit` plus
the rank ceiling itself. That also makes reset atomic — it was previously a
client-issued delete-then-insert pair that could leave a role with no
permissions at all if the second call failed.

**Still open (UI, not security):** the roles editor renders every toggle
regardless of the caller's own grants, so an out-of-authority toggle now
fails with a message rather than being disabled up front. `getRolesView`
already returns `actorRank`; adding the actor's grant set would let the page
gray those rows out.

Original finding, for the record:
- SQL: `role_perms_write_editor` (`20260901000001:95-99`) has no rank ceiling —
  any role holding `roles.edit` can grant **any** capability to any non-owner
  role, including its own. Only `owner` grants and `data_console.manage` are
  fenced.
- App: `setPermissionAction` (`identity-access/server/roles.ts:483-530`) has the
  same gap; its own comment documents the vulnerability class but the fix was
  scoped to one capability. `renameRoleAction`/`deleteRoleAction` also lack a
  rank check against the target role.

Decide the policy: either (a) an actor may only grant capabilities they
themselves hold ("no broader than own authority" — `canGrantRole()` already
exists in `permissions.ts:131`, unused here), or (b) document that `roles.edit`
== full admin and never seed it below org_admin. Then enforce it in the trigger
*and* the action.

### P1 — soon

**1.5 Expired-membership check inconsistency.** *(Fixed 2026-09-01 — see
correction below.)*

The first draft of this report called `requireOrgMember` /
`isActiveOrgMember` the canonical definition. That was wrong. The database
is the canonical definition, and roughly forty RLS policies all agree on it:

```sql
status = 'active' and (expires_at is null or expires_at > now())
```

Against that, the app layer had drifted in *both* directions:

| Definition | Where | Effect |
|---|---|---|
| `status='active' and expires_at is null` | `require-user.ts` `requireOrgMember`, `isActiveOrgMember` | **Too strict** — locks out a temporary member who still has days left |
| `status='active'` only | `orders/server/guards.ts` `requireOrgRole`, `lib/auth/require-permission.ts`, `seller/server/actions.ts` | **Too loose** — an expired temporary member keeps passing |

The loose branch mattered most: `require-permission.ts` is what the whole
dynamic-RBAC layer runs on, so *every* `requirePermission` call in the app
was admitting expired members, not just the two hand-rolled copies the
first draft named.

Fix applied: one shared `activeMembershipWindow()` in
`src/lib/auth/membership-window.ts`, used by `requireOrgMember`,
`isActiveOrgMember`, `requireOrgRole`, `require-permission.ts`, and the
`getOrgDrivers` assignment picker (an expired driver was still offered for
new runs). Admin *listing* queries were deliberately left alone — those
should keep showing expired members.

**1.6 Lock down the 3 cron edge functions.** *(Fixed and deployed 2026-09-01
— `20260901000008_cron_shared_secret.sql` + `_shared/cron-guard.ts`.)*

All three now require an `x-cron-secret` header matching their `CRON_SECRET`
env var. `CRON_SECRET` is set on the prod project and the new function code is
deployed; verified from the open internet that anonymous callers and wrong
secrets both get **401** where they previously got a full run.

**Discovered while doing it: the pg_cron jobs ran daily and did nothing.**

Correction to an earlier draft of this section, which said the schedules had
"never fired". They fired: `cron.job_run_details` holds 145 runs going back to
2026-06-25, every one `status = succeeded`. What never happened was the HTTP
call inside them — `net._http_response` contained exactly one row, id 1, which
was the manual verification on 2026-09-01. pg_net's sequence starting at 1 is
the proof no request had ever gone out.

That is the trap worth remembering: a green `cron.job_run_details` means the
job body ran without raising, and a body whose first act is to no-op reports
success just as loudly as one that did the work. Check `net._http_response`,
not the run log.

`app.functions_url` and `app.functions_key` are both unset on the prod
database, so all three jobs hit their own no-op guard and return without
making the HTTP call. Worse, they cannot be set from the app's own
credentials: the `postgres` role on hosted Supabase is refused with
`42501: permission denied to set parameter` for `app.cron_secret`,
`app.settings.cron_probe`, and by extension the two existing settings —
tried at both database and role scope. The `app.settings.jwt_exp` entry that
does exist was written by Supabase's provisioning, not by us.

So the daily access-review reminders, temporary-access expiry warnings and
KPDN price sync have never run automatically in production. The one
documented successful prod ingest (683 aggregates, 2026-08-23) was a manual
invocation.

**Resolved the same day by `20260901000009_cron_config_via_vault.sql`.** Job
config moved from `app.*` settings into Vault, read through a small
invoker-rights `public.cron_config()` helper that is granted to no API role.
Vault is writable and readable by `postgres` on hosted Supabase — verified
with a probe secret before designing around it — and is Supabase's documented
answer for pg_cron calling an Edge Function with a secret. The dead
`Authorization: Bearer app.functions_key` header is dropped; these functions
are `verify_jwt = false`, so it authenticated nothing.

Deployed and proven end to end on production: firing the exact job path
(`net.http_post` with the URL and secret read from Vault) at
`temporary-access-expiry` returned **HTTP 200** with a real body,
`{"notified":0,"memberships":0,"break_glass":0}` — Vault read, header sent,
function accepted, handler ran. All three prod jobs now show
`uses_vault = true`, no legacy setting, `active = true`. That target was
chosen deliberately: it had nothing to notify, so the test sent no email.

**One consequence to expect:** there are 4 access reviews already due within
48 hours on production that have never been notified, because the HTTP call
never went out. The next tick will email their reviewers.

**Also found: the schedule comments are wrong by 8 hours.** The prod database
runs in UTC, and pg_cron reads its expressions in the database timezone, so
`0 9 * * *` fires at 09:00 UTC — 17:00 MYT, not the "09:00 MYT" the migration
comments claim. Actual daily times: market-price-sync 05:15 UTC (13:15 MYT,
correctly documented), access-review-reminder 09:00 UTC (17:00 MYT),
temporary-access-expiry 09:30 UTC (17:30 MYT). Either fix the comments or
shift the expressions to 01:00/01:30 UTC if 09:00 MYT was the intent.

Nothing regressed by deploying the guard: since cron never invoked these
functions on prod, requiring the header broke no working automation. To
invoke one by hand now, send `-H "x-cron-secret: <value>"`; the value is in
`.env.local`.

Original finding:


`access-review-reminder`, `temporary-access-expiry`, `market-price-sync` run
`verify_jwt = false` with **no internal secret check** and a service-role
client. Anyone with the (guessable) function URL can trigger real emails to org
members (Resend quota burn / spam) or bulk market-price upserts (DoS / upstream
rate-limit risk). Add a shared-secret header that pg_cron sends and the function
verifies.

**1.7 `break_glass_update_end` policy: `with check (true)`**
(`20260624000002:417`). Once the USING clause matches, the actor can rewrite
*any* column of a security-audit row (`user_id`, `organization_id`, `reason`) —
not just close the event. Constrain the update, or move it to an RPC.

**1.8 `public_holidays` seeded for 2026 only, no rollover path.**
`leave_workday_count()` will treat every 2027 day as a workday. Add an admin UI
path or yearly seed job before December.

**1.9 Revalidation gaps.** `portal-actions.ts:283 cancelMyOrder` (buyer sees
stale "confirmed"), all of `buyer/server/address-actions.ts`,
`updateBuyerProfile`, and `setMarketState` when `orgSlug` omitted — mutations
without `revalidatePath`.

### P2 — hygiene

- **Input validation is inconsistent:** zod in ~8 action files, absent in ~10
  (seller: none at all; `order-actions.ts` mixed within one file). Also
  `searchCustomers` (`seller/server/actions.ts:272-281`) interpolates raw user
  input into a PostgREST `.or(\`name.ilike.%${query}%\`)` filter — escape the
  DSL special chars.
- **Raw `error.message` leaks** beyond seller/market: `schedule-actions.ts` (12
  sites), `facility-actions.ts` (10), `dispatch-actions.ts:137` catch-all,
  `sendPasswordResetAction:1262`. Contrast: `hr/manage-actions.ts` and
  `dashboard/analytics-actions.ts` map everything — copy that pattern.
- **`organizations` table world-readable, all columns** (`using (true)` +
  anon SELECT grant). Since `20260828000001` that includes `registration_no`,
  address, phone, email, plus internal `created_by`/`updated_by` uuids. Narrow
  to a public view with just the columns the buyer portal needs.
- **`audit.read` / `auth_security.read` capabilities have no consumer** — the
  RLS on `audit_log`/`auth_security_events` still hardcodes owner/org_admin, so
  granting the capability in the UI does nothing.
- **Migration hygiene:** 17 of 70 files lack explicit `begin/commit`; buyer/order
  table drops in `20260810000001` are unconditional ("dev data only") —
  fine now, dangerous as a pattern.

---

## 2. Duplication

**Architecture-level (the one that matters):** *three* parallel authorization
systems coexist —
1. Legacy role-list guards: `requireOrgRole(slug, roles[])` — still primary for
   orders/schedule/driver pipeline.
2. Dynamic RBAC: `requirePermission`/`actorCan` + `has_permission()` — current.
3. Legacy capability matrix: `can`/`canForOrg`/`resolveCapabilitiesForOrg` +
   `effective_capabilities()` RPC — **dead in production** (only its own test
   calls it) but still granted to `authenticated` in the DB.

Plus role lists defined in 4 places: `permissions.ts:22` `ROLES`,
`rbac.ts:34` `SYSTEM_ROLES`, `orders/lib/roles.ts:13` `ADMIN_ROLES` (no parity
test), and the SQL seed.

**Code-level:**
| What | Where | Note |
|---|---|---|
| Guard-wrapper boilerplate | 10 near-identical local `guard*()` wrappers (driver-actions:47, order-actions:67, schedule-actions:36, dispatch-actions:33+60, facility-actions:33, leave-actions:58, manage-actions:44, roles.ts:119, data-console:20) | One shared factory would do |
| `permissionMessageKey` switch | copy-pasted 6× across same files | |
| `ActionResult<T>` type | independently redefined in 5 files | |
| `rowToLeaveType`/`rowToBreakdown`/`rowToRequestSummary` | byte-identical in leave-actions + manage-actions | |
| `formatPrice` | byte-identical `seller/lib/pricing.ts:14` + `orders/lib/order-model.ts:126` | |
| `formatDate` | 4 inline copies in client components; customers-client bypasses next-intl entirely (i18n bug) | |
| `getOrganizationBySlug` | `buyer/server/actions.ts:44` + `identity-access/server/queries.ts:36` | |
| Buyer-by-`auth.uid()` lookup | 3 reimplementations ignoring shared `buyer-auth.ts` helpers | |
| `Product`/`CatalogWithProducts` types | DB-generated in `seller/types.ts` vs hand-rolled divergent copy in `buyer/types.ts` — same exported names, different shapes | schema-drift trap |
| Edge `_shared/{messages,resend}.ts` | manual copies of `src/lib/email/*`, no drift guard | |
| RLS membership predicate | same subquery copy-pasted across ~60 policy blocks in SQL instead of one stable helper function | makes 1.1 a bigger diff than it should be |
| Role CHECK constraints | same 3-table drop/add block repeated in 4 migrations | mostly retired by role_id FK now |
| Seed-data SQL | `admin_seed_demo_data` redefined 6×, each a near-full copy, final body 434 lines | git-history noise only |

---

## 3. What we don't need (delete list)

| Item | Evidence |
|---|---|
| **`proxy.ts` (repo root)** | Never loaded (src/-rooted project), contradicts `src/middleware.ts` design comment, broken route-group check, untouched since initial commit |
| **`role_capability_overrides` table** + its RLS migration + `effective_capabilities()` RPCs | Superseded by `role_permissions`; own comment says "dropped in Task 13" — drop it for real |
| **`permissions.server.ts`: `resolveCapabilitiesForOrg`, `canForOrg`** | Zero production callers (test-only) — the whole legacy capability subsystem |
| **`role_rank(text)` SQL function** | Zero call sites after `org_role_rank` replaced it |
| **Dead deps: `bwip-js`, `pino`** | Zero references in src/scripts/config (pino's one grep hit = "Fili**pino**") |
| **Dead exports** | `requireSellerRole` + `getOrganizationId` + `getProductWithVariants` (seller/actions), `createOrganizationAction`, `getSettlementQueue`, `updateBay`, `requireAny`, `isActiveOrgMember` |
| **Break-glass back half** | `endBreakGlassAction`, `finalizeBreakGlassReviewAction`, `break-glass.ts` `isBreakGlassActive`/`listActive`/`recordPostUseReview` — open side is wired, close/review side never was. Decide: finish the feature or delete the half |

Precedent exists: `20260711000001_cleanup_unused_tables.sql` dropped 31 dead
tables cleanly. Do the same for the RBAC leftovers.

---

## 4. What we can improve (structural, non-urgent)

- **Extract one shared action toolkit**: `guardAction(slug, resource, action)`
  factory + shared `ActionResult<T>` + shared error mapper. Kills rows 1–3 of
  the duplication table and makes "which guard system?" a non-question.
- **One RLS helper function** (`is_active_member(org)` /
  `has_permission(...)`) used by every policy instead of inlined subqueries —
  then finishing 1.1 becomes a mechanical sweep.
- **Generate buyer types from the DB types** (`Pick<...>` off
  `Database["public"]`) instead of hand-rolling; delete the divergent copies.
- **Index `leave_credit_requests`** on `(organization_id, status)` before it
  grows (sibling `leave_requests` has both indexes).
- **CHECK constraint or lookup table for `market_prices.item_code`** — valid
  values currently live only in a SQL comment; bad ingest rows pass silently.
- **Run/order state machine**: `set_run_status` redefined 6×, `dispatch_*`
  patched 3× for phantom-deliver edge cases — churn signal. Next touch in this
  area, write the state machine down first.
- **Pre-commit grep** for `INSERT INTO auth.users` / hardcoded passwords in
  `migrations/` — the leaked-owner-credential incident (`20260710000001`)
  already happened once.
- **Edge/app email code sharing**: single source with a build step or a parity
  test, instead of hand-copied `_shared/` files.

## What's already good (keep doing this)

- 47/47 tables RLS-enabled; zero anon writes; sequences never granted.
- Every SECURITY DEFINER function pins `search_path`; none trusts a
  client-supplied org/user id without re-verification (`place_order` is a model
  citizen).
- `20260823000005_lock_down_anon_grants.sql` bakes a self-failing regression
  check into the migration itself.
- Rank-ladder triggers + owner-demote guard (`20260901000003/4`) show real
  threat modeling.
- `admin.*` service-role API: narrow, named, every call site behind
  `actorCan` + reauth. No weakly-guarded path reaches it.
- `hr/manage-actions.ts` and `dashboard/analytics-actions.ts` are the reference
  implementations for guard + validation + error mapping.

---

## Suggested order of attack

1. Guard seller + market actions (1.2, 1.3) — hours, closes the scariest gap.
2. Expired-membership filter fix (1.5) — one shared-helper refactor.
3. RBAC "Task 13" migration: RLS + storage policies onto `has_permission`,
   drop `role_capability_overrides`/`effective_capabilities`/`role_rank` (1.1 + §3).
4. `roles.edit` grant-bounding decision + enforcement (1.4).
5. Cron-function shared secret (1.6).
6. Delete list (§3) + dedup toolkit (§4) opportunistically alongside.


---

## What is left (2026-09-01)

Everything below was considered and consciously deferred, not missed.

**Structural, wanted but not urgent**

- *Shared action toolkit.* Ten near-identical `guard*()` wrappers, six copies
  of the `permissionMessageKey` switch and five independent definitions of
  `ActionResult<T>` remain. Collapsing them is the single biggest readability
  win left, but it touches ~10 server files at once and is the wrong shape of
  change to land unattended.
- *Buyer type divergence.* `Product` and `CatalogWithProducts` are declared
  twice with the same names and different shapes — DB-generated in
  `seller/types.ts`, hand-rolled in `buyer/types.ts`. Should be `Pick<>`s off
  the generated types.
- *Input validation.* Roughly half the server actions zod-parse their input;
  the rest take positional args unchecked. `order-actions.ts` is inconsistent
  within a single file.

**Judgement calls, left as they are**

- `market_prices.item_code` has no CHECK constraint. Valid codes live in a
  comment. Left alone deliberately: only the ingest writes this column and it
  writes a fixed list, so a constraint tight enough to be useful is also tight
  enough to break the next time KPDN adds an item.
- `endBreakGlassAction` / `finalizeBreakGlassReviewAction` are unreferenced.
  Whether break-glass should have a close/review flow at all is a product
  decision, not dead-code removal.
- 17 of the migrations lack explicit `begin`/`commit`. Cosmetic.

**Needs a person**

- *2027 public holidays.* `leave_workday_count` now refuses rather than
  miscounting, so on 1 January leave applications fail until the dates are
  entered. Add them to `seed_public_holidays()` when gazetted.
- *Roles editor UI.* Out-of-authority permission toggles still render and fail
  on submit rather than being disabled. `getRolesView` returns `actorRank`
  already; it would also need the actor's grant set.
- *The frontend has never been deployed.* Unchanged, and still the item that
  decides whether any of the rest matters.
