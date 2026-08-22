# Customer–Buyer Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every buyer portal account gets a linked `customers` row at signup (auto-linked by normalized phone match), sellers can record an email on any customer, and the Customers list shows which customers have portal accounts.

**Architecture:** A database trigger on `buyers` insert runs a shared SECURITY DEFINER link-or-create function (same philosophy as RLS: data invariants live in the DB). A generated `phone_normalized` column makes `012-722 3344`, `+60127223344`, and `0127223344` match. The app layer only gains an email field (dialog + server actions) and a "Portal" badge (left join on `buyers.customer_id`).

**Tech Stack:** Supabase (Postgres, pgTAP), Next.js App Router server actions, zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-23-customer-buyer-sync-design.md`

## Global Constraints

- Phone normalization must mirror `normalizeMalaysianMobile` in `src/features/buyer-auth/lib/phone.ts`: strip non-digits, then a leading `60` (with total length ≥ 10) becomes `0` (dropping one duplicate leading `0` after the country code).
- Seller-entered customer fields (name, address, notes) are NEVER overwritten by sync; `customers.email` is filled only when null.
- A customer row already claimed by another buyer is never re-linked ("no stealing").
- `place_order`'s lazy create-and-link in `supabase/migrations/20260810000002_order_pipeline_functions.sql:255-270` stays untouched.
- Existing constraint: `customers.phone` check `char_length(phone) between 5 and 20`; buyers without a phone get `'-----'` (the `place_order` convention).
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Local gates: `npm run typecheck`, `npm run lint`, `npm test` (Vitest), `npm run db:test` (pgTAP, needs `npx supabase db reset` first when migrations changed), `npm run test:e2e` (Playwright, needs dev stack running).
- Spec item "buyer signup phone becomes required" is already satisfied in code (`BuyerSignupInput` uses `z.string().min(1)` plus `normalizeMalaysianMobile` rejection in `src/features/buyer-auth/server/auth-actions.ts:31,44-49`) — no task needed; do not change the signup form.

---

### Task 1: Migration — normalize fn, email column, sync trigger, backfill (pgTAP TDD)

**Files:**
- Create: `supabase/tests/rls/21_customer_buyer_sync.sql`
- Create: `supabase/migrations/20260823000006_customer_buyer_sync.sql`

**Interfaces:**
- Consumes: existing tables `public.customers`, `public.buyers`, `auth.users`; existing check constraints listed in Global Constraints.
- Produces: `public.normalize_phone(text) returns text` (immutable); `public.customers.email text null`; `public.customers.phone_normalized text` (stored generated); `public.link_or_create_customer_for_buyer(p_buyer_id uuid) returns void` (SECURITY DEFINER); trigger `buyers_sync_customer` AFTER INSERT ON `public.buyers`. Task 2 regenerates TS types from this schema.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/rls/21_customer_buyer_sync.sql`:

```sql
-- supabase/tests/rls/21_customer_buyer_sync.sql
-- Customer–buyer sync: normalize_phone, signup trigger link-or-create,
-- email fill rules, no-steal, idempotency, function grants.

begin;
select plan(18);

-- ---------------------------------------------------------------------------
-- normalize_phone
-- ---------------------------------------------------------------------------
select is(public.normalize_phone('012-722 3344'), '0127223344', 'dashes and spaces stripped');
select is(public.normalize_phone('+60127223344'), '0127223344', 'E.164 collapses to national format');
select is(public.normalize_phone('0127223344'), '0127223344', 'national format unchanged');
select is(public.normalize_phone(null), '', 'null becomes empty string');

-- ---------------------------------------------------------------------------
-- Seed: org, seller, one admin-created customer, one customer with email set.
-- Superuser context bypasses RLS for seeding (same as other test files).
-- ---------------------------------------------------------------------------
insert into auth.users (id) values
  ('a0000000-0000-0000-0000-0000000000aa')            -- seller
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('b0000000-0000-0000-0000-0000000000b1', 'buyer1@example.com'),
  ('b0000000-0000-0000-0000-0000000000b2', 'buyer2@example.com'),
  ('b0000000-0000-0000-0000-0000000000b3', 'buyer3@example.com'),
  ('b0000000-0000-0000-0000-0000000000b4', 'buyer4@example.com')
on conflict (id) do nothing;

insert into public.organizations (id, name, slug)
values ('c0000000-0000-0000-0000-0000000000cc', 'Sync Test Org', 'sync-test-org')
on conflict (id) do nothing;

insert into public.customers (id, organization_id, name, phone, created_by)
values ('d0000000-0000-0000-0000-0000000000d1',
        'c0000000-0000-0000-0000-0000000000cc',
        'Ayamas Frozen Mart', '012-722 3344',
        'a0000000-0000-0000-0000-0000000000aa');

insert into public.customers (id, organization_id, name, phone, email, created_by)
values ('d0000000-0000-0000-0000-0000000000d2',
        'c0000000-0000-0000-0000-0000000000cc',
        'Kedai Emel Tetap', '013-999 8877', 'owner@fixed.my',
        'a0000000-0000-0000-0000-0000000000aa');

-- ---------------------------------------------------------------------------
-- Buyer 1 signs up with the E.164 form of customer d1's phone: auto-link.
-- ---------------------------------------------------------------------------
insert into public.buyers (id, organization_id, display_name, phone)
values ('b0000000-0000-0000-0000-0000000000b1',
        'c0000000-0000-0000-0000-0000000000cc', 'Buyer One', '+60127223344');

select results_eq(
  $$ select customer_id from public.buyers where id = 'b0000000-0000-0000-0000-0000000000b1' $$,
  array['d0000000-0000-0000-0000-0000000000d1'::uuid],
  'phone match links buyer to existing customer'
);
select results_eq(
  $$ select count(*)::int from public.customers
     where organization_id = 'c0000000-0000-0000-0000-0000000000cc'
       and phone_normalized = '0127223344' $$,
  array[1],
  'no duplicate customer row created on match'
);
select results_eq(
  $$ select email from public.customers where id = 'd0000000-0000-0000-0000-0000000000d1' $$,
  array['buyer1@example.com'],
  'null customer email filled from auth.users'
);
select results_eq(
  $$ select name from public.customers where id = 'd0000000-0000-0000-0000-0000000000d1' $$,
  array['Ayamas Frozen Mart'],
  'seller-entered name never overwritten'
);

-- ---------------------------------------------------------------------------
-- Buyer 2, same phone: d1 is claimed, so a NEW row is created (no stealing).
-- ---------------------------------------------------------------------------
insert into public.buyers (id, organization_id, display_name, phone)
values ('b0000000-0000-0000-0000-0000000000b2',
        'c0000000-0000-0000-0000-0000000000cc', 'Buyer Two', '0127223344');

select ok(
  (select customer_id from public.buyers where id = 'b0000000-0000-0000-0000-0000000000b2')
    is distinct from 'd0000000-0000-0000-0000-0000000000d1'::uuid
  and (select customer_id from public.buyers where id = 'b0000000-0000-0000-0000-0000000000b2')
    is not null,
  'claimed customer is not stolen; second buyer gets a fresh row'
);
select results_eq(
  $$ select count(*)::int from public.customers
     where organization_id = 'c0000000-0000-0000-0000-0000000000cc'
       and phone_normalized = '0127223344' $$,
  array[2],
  'second buyer created a second customer row'
);
select results_eq(
  $$ select c.name from public.customers c
     join public.buyers b on b.customer_id = c.id
     where b.id = 'b0000000-0000-0000-0000-0000000000b2' $$,
  array['Buyer Two'],
  'created row takes the buyer display name'
);

-- ---------------------------------------------------------------------------
-- Buyer 3 matches d2, whose email is already set: email preserved.
-- ---------------------------------------------------------------------------
insert into public.buyers (id, organization_id, display_name, phone)
values ('b0000000-0000-0000-0000-0000000000b3',
        'c0000000-0000-0000-0000-0000000000cc', 'Buyer Three', '0139998877');

select results_eq(
  $$ select email from public.customers where id = 'd0000000-0000-0000-0000-0000000000d2' $$,
  array['owner@fixed.my'],
  'existing customer email never overwritten'
);

-- ---------------------------------------------------------------------------
-- Buyer 4 has no phone: a row is still created and linked.
-- ---------------------------------------------------------------------------
insert into public.buyers (id, organization_id, display_name)
values ('b0000000-0000-0000-0000-0000000000b4',
        'c0000000-0000-0000-0000-0000000000cc', 'Buyer Four');

select ok(
  (select customer_id from public.buyers where id = 'b0000000-0000-0000-0000-0000000000b4') is not null,
  'phoneless buyer still gets a linked customer row'
);
select results_eq(
  $$ select c.name from public.customers c
     join public.buyers b on b.customer_id = c.id
     where b.id = 'b0000000-0000-0000-0000-0000000000b4' $$,
  array['Buyer Four'],
  'phoneless buyer row named after display name'
);

-- ---------------------------------------------------------------------------
-- Idempotency: re-running the shared function changes nothing.
-- ---------------------------------------------------------------------------
select public.link_or_create_customer_for_buyer('b0000000-0000-0000-0000-0000000000b1');
select results_eq(
  $$ select count(*)::int from public.customers
     where organization_id = 'c0000000-0000-0000-0000-0000000000cc' $$,
  array[4],
  're-run creates nothing (idempotent)'
);
select results_eq(
  $$ select customer_id from public.buyers where id = 'b0000000-0000-0000-0000-0000000000b1' $$,
  array['d0000000-0000-0000-0000-0000000000d1'::uuid],
  're-run keeps the original link'
);

-- ---------------------------------------------------------------------------
-- Grants: definer function is not callable by app roles (explicit, not inherited).
-- ---------------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'public.link_or_create_customer_for_buyer(uuid)', 'execute'),
  'anon cannot execute link_or_create_customer_for_buyer'
);
select ok(
  not has_function_privilege('authenticated', 'public.link_or_create_customer_for_buyer(uuid)', 'execute'),
  'authenticated cannot execute link_or_create_customer_for_buyer'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx supabase db reset && npm run db:test
```

Expected: `21_customer_buyer_sync` FAILS (errors on missing `public.normalize_phone` / missing `phone_normalized` column). All pre-existing test files still pass.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260823000006_customer_buyer_sync.sql`:

```sql
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx supabase db reset && npm run db:test
```

Expected: `21_customer_buyer_sync` passes 18/18. ALL other files must also pass. Known side effect to watch: every pre-existing test that inserts `public.buyers` rows now fires the trigger and creates `customers` rows. If any older test asserts a `customers` count that is now off by the number of buyers it seeded, update that assertion to the new expected count (the trigger-created rows are correct behavior, the old count is stale) — do not weaken any other assertion.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260823000006_customer_buyer_sync.sql supabase/tests/rls/21_customer_buyer_sync.sql
git commit -m "feat(customers): sync buyer signups into customers via phone auto-link trigger

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Types + server actions — email field and portal flag

**Files:**
- Modify: `src/types/database.generated.ts` (regenerated, not hand-edited)
- Create: `src/features/seller/lib/customer-schema.ts`
- Create: `src/features/seller/tests/unit/customer-schema.test.ts`
- Modify: `src/features/seller/types.ts`
- Modify: `src/features/seller/server/actions.ts:256-309`

**Interfaces:**
- Consumes: Task 1's schema (`customers.email`, `buyers.customer_id` FK); existing RLS policy `buyers_select_seller` (org staff may select their org's buyers — this is what makes the embed return rows).
- Produces: `parseCustomerEmail(raw: unknown): string | null` (throws `Error("Invalid email address")` on bad input); `type CustomerWithPortal = Customer & { has_portal_account: boolean }` exported from `src/features/seller/types.ts`; `getCustomers(orgId: string): Promise<CustomerWithPortal[]>`. Task 3 consumes all three.

- [ ] **Step 1: Regenerate DB types**

```bash
npm run db:types
```

Expected: `src/types/database.generated.ts` diff shows `email` and `phone_normalized` under `customers` Row/Insert/Update.

- [ ] **Step 2: Write the failing unit test**

Create `src/features/seller/tests/unit/customer-schema.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { parseCustomerEmail } from "../../lib/customer-schema";

describe("parseCustomerEmail", () => {
  test("null and undefined pass through as null", () => {
    expect(parseCustomerEmail(null)).toBeNull();
    expect(parseCustomerEmail(undefined)).toBeNull();
  });

  test("empty and whitespace-only strings become null", () => {
    expect(parseCustomerEmail("")).toBeNull();
    expect(parseCustomerEmail("   ")).toBeNull();
  });

  test("valid email is trimmed and returned", () => {
    expect(parseCustomerEmail("  kak.ros@example.my ")).toBe("kak.ros@example.my");
  });

  test("invalid email throws", () => {
    expect(() => parseCustomerEmail("not-an-email")).toThrow("Invalid email address");
    expect(() => parseCustomerEmail(42)).toThrow("Invalid email address");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run src/features/seller/tests/unit/customer-schema.test.ts
```

Expected: FAIL — cannot resolve `../../lib/customer-schema`.

- [ ] **Step 4: Implement the schema helper**

Create `src/features/seller/lib/customer-schema.ts`:

```ts
import { z } from "zod";

const EmailSchema = z.string().email().max(254);

/**
 * Optional-email parsing for the customer dialog: blank means "no email",
 * anything non-blank must be a valid address.
 */
export function parseCustomerEmail(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") throw new Error("Invalid email address");
  const value = raw.trim();
  if (value === "") return null;
  const parsed = EmailSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid email address");
  return parsed.data;
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run src/features/seller/tests/unit/customer-schema.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 6: Export the portal-flag type**

In `src/features/seller/types.ts`, directly under the `CustomerUpdate` line (line 17), add:

```ts
export type CustomerWithPortal = Customer & { has_portal_account: boolean };
```

- [ ] **Step 7: Update the server actions**

In `src/features/seller/server/actions.ts`:

Add to the existing type import from `../types` (line 12 area): `CustomerWithPortal` is NOT needed here as an import unless the return type is annotated — annotate it, so import it. Add near the other imports:

```ts
import { parseCustomerEmail } from "../lib/customer-schema";
```

and extend the existing `import type { ... } from "../types"` list with `CustomerWithPortal`.

Replace `getCustomers` (lines 256-264) with:

```ts
export async function getCustomers(orgId: string): Promise<CustomerWithPortal[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("*, buyers(id)")
    .eq("organization_id", orgId)
    .order("name");
  return (data ?? []).map(({ buyers, ...customer }) => ({
    ...customer,
    has_portal_account: (buyers?.length ?? 0) > 0,
  }));
}
```

In `createCustomer` (lines 277-295), validate email before insert — replace the insert call with:

```ts
  const email = parseCustomerEmail(input.email);

  const { data, error } = await supabase
    .from("customers")
    .insert({ ...input, email, organization_id: orgId, created_by: user.user.id })
    .select()
    .single();
```

In `updateCustomer` (lines 297-309), validate only when the caller sends the field — replace the update call with:

```ts
  const patch = "email" in input ? { ...input, email: parseCustomerEmail(input.email) } : input;

  const { data, error } = await supabase
    .from("customers")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
```

- [ ] **Step 8: Typecheck and full unit suite**

```bash
npm run typecheck && npm test
```

Expected: both pass. (If `buyers` in the embed types as an object instead of an array, the select alias is wrong — the correct shape with a to-many reverse FK embed is an array.)

- [ ] **Step 9: Commit**

```bash
git add src/types/database.generated.ts src/features/seller/lib/customer-schema.ts src/features/seller/tests/unit/customer-schema.test.ts src/features/seller/types.ts src/features/seller/server/actions.ts
git commit -m "feat(customers): optional email on customer actions + portal-account flag in getCustomers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Customers UI — email field, Portal badge, email under name

**Files:**
- Modify: `src/app/(seller)/[organizationSlug]/customers/customers-client.tsx`

**Interfaces:**
- Consumes: `CustomerWithPortal` and updated `createCustomer`/`updateCustomer` from Task 2 (both still return a plain `Customer` row — the client re-attaches the flag).
- Produces: the seller-facing UI; Task 4's e2e asserts against the exact strings used here ("Email" label, "Portal" badge text).

- [ ] **Step 1: Update the client component**

In `src/app/(seller)/[organizationSlug]/customers/customers-client.tsx`:

1. Type + import changes:

```ts
import type { CustomerWithPortal } from "@/features/seller/types";
import { Badge } from "@/components/ui/badge";
```

Replace the `Customer` import and usages: `initialCustomers: CustomerWithPortal[]` in `CustomersClientProps`, `useState<CustomerWithPortal | null>(null)` for `editingCustomer` (line 50).

2. Form state (lines 51-56) gains email:

```ts
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    notes: "",
  });
```

`openCreateDialog` resets it: `setFormData({ name: "", phone: "", email: "", address: "", notes: "" })`.
`openEditDialog` loads it: add `email: customer.email || "",` to the object.

3. Search filter (lines 58-62) also matches email:

```ts
  const filteredCustomers = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search) ||
      (c.email ?? "").toLowerCase().includes(search.toLowerCase())
  );
```

4. `handleSubmit` passes email and re-attaches the portal flag:

```ts
      if (editingCustomer) {
        const updated = await updateCustomer(editingCustomer.id, {
          name: formData.name,
          phone: formData.phone,
          email: formData.email || null,
          address: formData.address || null,
          notes: formData.notes || null,
        });
        setCustomers(
          customers.map((c) =>
            c.id === updated.id
              ? { ...updated, has_portal_account: c.has_portal_account }
              : c
          )
        );
        toast({ title: "Customer updated" });
      } else {
        const newCustomer = await createCustomer(organizationId, {
          name: formData.name,
          phone: formData.phone,
          email: formData.email || null,
          address: formData.address || null,
          notes: formData.notes || null,
        });
        setCustomers([...customers, { ...newCustomer, has_portal_account: false }]);
        toast({ title: "Customer created" });
      }
```

5. Name cell (lines 175) becomes badge + email second line:

```tsx
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <span>{customer.name}</span>
                      {customer.has_portal_account && (
                        <Badge variant="secondary">Portal</Badge>
                      )}
                    </div>
                    {customer.email && (
                      <div className="text-xs font-normal text-muted-foreground">
                        {customer.email}
                      </div>
                    )}
                  </TableCell>
```

6. Dialog: between the Phone block (ends line 258) and the Address block, insert:

```tsx
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
```

- [ ] **Step 2: Typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: both pass. The server page `src/app/(seller)/[organizationSlug]/customers/page.tsx` passes `getCustomers` output straight through, so its prop type follows automatically; if it annotates `Customer[]` explicitly, switch that annotation to `CustomerWithPortal[]`.

- [ ] **Step 3: Visual check in the preview browser**

Start the dev server, open `/ayam-norliza-pilot/customers` as the owner, and verify with `read_page` (not screenshot): the E2E buyer rows created by the backfill now appear with a "Portal" badge and their signup email under the name; the Add Customer dialog shows Name, Phone, Email, Address, Notes in that order.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(seller)/[organizationSlug]/customers/customers-client.tsx"
git commit -m "feat(customers): email field in dialog, Portal badge and email in list

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: e2e — signup links to admin-created customer, no duplicate

**Files:**
- Create: `e2e/customer-sync.spec.ts`

**Interfaces:**
- Consumes: `signIn`, `OWNER`, `uniqueFixtureName` from `e2e/_fixtures.ts`; buyer signup labels from `src/app/buyer_portal/[organizationSlug]/login/page.tsx` ("Your Name", "Email", "Phone (for WhatsApp)", "Password", "Confirm Password", button "Create Account" — exactly as `e2e/buyer-address.spec.ts:157-164` uses them); UI strings from Task 3 ("Portal", "Email").
- Produces: regression coverage for the link path end to end.

- [ ] **Step 1: Write the e2e spec**

Create `e2e/customer-sync.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { OWNER, signIn, uniqueFixtureName } from "./_fixtures";

// A unique valid Malaysian mobile per run so reruns never collide on the
// phone-match trigger: "01" + 8 digits = 10 digits, passes normalizeMalaysianMobile.
function uniquePhone(): string {
  return "01" + String(Date.now()).slice(-8);
}

test("buyer signup auto-links to the admin-created customer with the same phone", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);

  const customerName = uniqueFixtureName("E2E Sync Cafe");
  const buyerName = uniqueFixtureName("E2E Sync Buyer");
  const phone = uniquePhone();
  const dashedPhone = `${phone.slice(0, 3)}-${phone.slice(3)}`; // admin types it dashed
  const buyerEmail = `e2e-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const buyerPassword = "test-only-password-12-chars";

  // Step 1: admin creates the customer (dashed phone, no email).
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/ayam-norliza-pilot/customers");
  await page.getByRole("button", { name: "Add Customer" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name *").fill(customerName);
  await dialog.getByLabel("Phone *").fill(dashedPhone);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(
    page.getByRole("row").filter({ hasText: customerName })
  ).toBeVisible({ timeout: 20_000 });

  // Step 2: buyer signs up in a fresh context (true anon path — see
  // e2e/buyer-address.spec.ts for why a shared context would mask bugs)
  // with the E.164-normalizable bare form of the same phone.
  const buyerContext = await browser.newContext();
  const buyerPage = await buyerContext.newPage();
  await buyerPage.goto("/buyer_portal/ayam-norliza-pilot/login");
  await buyerPage.getByRole("button", { name: "Sign up" }).click();
  await buyerPage.getByLabel("Your Name").fill(buyerName);
  await buyerPage.getByLabel("Email").fill(buyerEmail);
  await buyerPage.getByLabel("Phone (for WhatsApp)").fill(phone);
  await buyerPage.getByLabel("Password", { exact: true }).fill(buyerPassword);
  await buyerPage.getByLabel("Confirm Password").fill(buyerPassword);
  await buyerPage.getByRole("button", { name: "Create Account" }).click();
  await expect(buyerPage).toHaveURL(/\/buyer_portal\/ayam-norliza-pilot\/shop/, {
    timeout: 20_000,
  });
  await buyerContext.close();

  // Step 3: the admin's list shows ONE linked row, not a duplicate.
  await page.goto("/ayam-norliza-pilot/customers");
  const linkedRow = page.getByRole("row").filter({ hasText: customerName });
  await expect(linkedRow).toHaveCount(1, { timeout: 20_000 });
  await expect(linkedRow.getByText("Portal")).toBeVisible();
  await expect(linkedRow.getByText(buyerEmail)).toBeVisible();
  // No second row named after the buyer account.
  await expect(page.getByRole("row").filter({ hasText: buyerName })).toHaveCount(0);
});
```

- [ ] **Step 2: Run the spec**

With the local Supabase + dev server running (same setup as the existing e2e suite):

```bash
npm run test:e2e -- customer-sync.spec.ts
```

Expected: 1 passed. If the `getByLabel("Name *")` locators miss, check the dialog's rendered label text with Playwright's error snapshot — the labels include the literal `*` per `customers-client.tsx` ("Name *", "Phone *"); adjust only the locator, never the assertion targets.

- [ ] **Step 3: Run the full e2e suite to catch regressions**

```bash
npm run test:e2e
```

Expected: all specs pass. Existing buyer signups all reuse phone `012-345 6789`; with the trigger they now link or create per the no-steal rule — neither outcome breaks those specs since none assert customers-table contents, but a failure here means one does: read that spec and update its expectation to the trigger-era behavior.

- [ ] **Step 4: Commit**

```bash
git add e2e/customer-sync.spec.ts
git commit -m "test(customers): e2e coverage for buyer signup auto-link, no duplicate rows

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Full gates

**Files:** none new.

**Interfaces:** none — final verification only.

- [ ] **Step 1: Run every local gate**

```bash
npm run typecheck && npm run lint && npm test && npx supabase db reset && npm run db:test && npm run test:e2e
```

Expected: all pass. Fix anything red before proceeding; re-run the failing gate after each fix.

- [ ] **Step 2: Finish the branch**

Use the superpowers:finishing-a-development-branch skill to decide merge/PR/cleanup.
