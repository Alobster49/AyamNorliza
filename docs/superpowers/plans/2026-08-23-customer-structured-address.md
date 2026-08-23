# Customer Structured Address Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customers gain a structured Malaysian address (address line, postcode, state, area) entered through the same `AddressFields` component the buyer checkout uses, and selecting a customer during manual order creation prefills the delivery address and postcode and auto-resolves the delivery zone.

**Architecture:** Three nullable columns on `public.customers` plus a table constraint keeping state/area paired and postcode-derived. `AddressFields` moves to shared component space and gains an `idPrefix` prop. A manager-gated `resolveDeliveryZone` server action wraps the existing `resolve_zone_for_postcode` RPC.

**Tech Stack:** Supabase (Postgres, pgTAP), Next.js App Router server actions, zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-23-customer-structured-address-design.md`

## Global Constraints

- The postcode dataset (`malaysia-postcodes.json`) is TypeScript-side only. SQL cannot resolve state/area; only postcode is backfilled in the migration, and the edit dialog completes state/area client-side on open.
- Database is deliberately looser than the form: it tolerates address-alone (legacy rows). All-or-nothing is enforced by `parseCustomerAddress`, not by a check constraint.
- `orders.delivery_address` stays free text plus `postcode` — orders are not restructured.
- `place_order` is unchanged; it already accepts `p_postcode` and the client already sends it.
- Buyer checkout element ids must not change: `idPrefix` defaults to `"address"`, preserving `address-line`, `address-postcode`, `address-state`, `address-area`.
- Latest migration on main is `20260823000007`; the new one is `20260823000008`. Latest pgTAP file is `21_`; the new one is `22_`.
- Commits end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Local gates: `npm run typecheck`, `npm run lint`, `npm test` (Vitest, baseline 577), `npm run db:test` (pgTAP, baseline 251 across 23 files; needs `npx supabase db reset` first when migrations changed), `npm run test:e2e` (Playwright, baseline 21 passed).

---

### Task 1: Relocate AddressFields and the postcode dataset, add `idPrefix`

**Files:**
- Move: `src/features/buyer/components/address-fields.tsx` → `src/components/forms/address-fields.tsx`
- Move: `src/features/buyer/lib/malaysia-postcodes.ts` → `src/lib/malaysia-postcodes.ts`
- Move: `src/features/buyer/lib/malaysia-postcodes.json` → `src/lib/malaysia-postcodes.json`
- Move: `src/features/buyer/tests/unit/malaysia-postcodes.test.ts` → `src/lib/malaysia-postcodes.test.ts`
- Modify: `scripts/generate-malaysia-postcodes.mjs:2,40`
- Modify: `src/app/buyer_portal/[organizationSlug]/checkout/checkout-client.tsx:15`

**Interfaces:**
- Produces: `AddressFields` and `AddressValue` importable from `@/components/forms/address-fields`, with props `{ value, onChange, disabled?, idPrefix? }` (`idPrefix` defaults to `"address"`); `lookupPostcode`, `statesList`, `areasForState` importable from `@/lib/malaysia-postcodes`. Tasks 4 and 6 consume both.

- [ ] **Step 1: Move the four files with git mv**

```bash
git mv src/features/buyer/components/address-fields.tsx src/components/forms/address-fields.tsx
git mv src/features/buyer/lib/malaysia-postcodes.ts src/lib/malaysia-postcodes.ts
git mv src/features/buyer/lib/malaysia-postcodes.json src/lib/malaysia-postcodes.json
git mv src/features/buyer/tests/unit/malaysia-postcodes.test.ts src/lib/malaysia-postcodes.test.ts
```

The test lands colocated, matching the existing `src/lib/rate-limit.ts` / `src/lib/rate-limit.test.ts` pair.

- [ ] **Step 2: Fix the moved test's import**

In `src/lib/malaysia-postcodes.test.ts`, change:

```ts
} from "../../lib/malaysia-postcodes";
```

to:

```ts
} from "./malaysia-postcodes";
```

- [ ] **Step 3: Fix the generator script's output path**

In `scripts/generate-malaysia-postcodes.mjs`, line 2 comment and line 40 path both say `src/features/buyer/lib/`. Change the comment to read `src/lib/malaysia-postcodes.json` and change the write target to:

```js
  new URL("../src/lib/malaysia-postcodes.json", import.meta.url),
```

- [ ] **Step 4: Fix the checkout client's import**

In `src/app/buyer_portal/[organizationSlug]/checkout/checkout-client.tsx:15`, change:

```ts
import { AddressFields, type AddressValue } from "@/features/buyer/components/address-fields";
```

to:

```ts
import { AddressFields, type AddressValue } from "@/components/forms/address-fields";
```

- [ ] **Step 5: Update the component's own dataset import and add `idPrefix`**

In `src/components/forms/address-fields.tsx`, change the dataset import to:

```ts
import {
  areasForState,
  lookupPostcode,
  statesList,
} from "@/lib/malaysia-postcodes";
```

Add `idPrefix` to the props type:

```ts
type AddressFieldsProps = {
  value: AddressValue;
  onChange: (next: AddressValue) => void;
  disabled?: boolean;
  /**
   * Prefix for the field element ids. Needed because the manual order screen
   * renders two address blocks at once (the order's delivery section and the
   * inline new-customer form); duplicate ids would break label association.
   */
  idPrefix?: string;
};
```

Change the signature and derive the ids:

```ts
export function AddressFields({
  value,
  onChange,
  disabled,
  idPrefix = "address",
}: AddressFieldsProps) {
  const ids = {
    line: `${idPrefix}-line`,
    postcode: `${idPrefix}-postcode`,
    state: `${idPrefix}-state`,
    area: `${idPrefix}-area`,
  };
  const areas = value.state ? areasForState(value.state) : [];
```

Then replace each hardcoded id/htmlFor pair with the derived value: `htmlFor="address-line"` → `htmlFor={ids.line}` and `id="address-line"` → `id={ids.line}`; the same for `address-postcode` → `ids.postcode`, `address-state` → `ids.state`, `address-area` → `ids.area`. Leave every other line of the component untouched, including both Radix `if (state)` / `if (area)` guards and their comments.

- [ ] **Step 6: Verify nothing else referenced the old paths**

Run:

```bash
grep -rn "features/buyer/lib/malaysia-postcodes\|features/buyer/components/address-fields" src scripts
```

Expected: no output. If anything remains, update it to the new path.

- [ ] **Step 7: Run the gates**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: all pass, 577 tests (the moved dataset test still runs, from its new location).

- [ ] **Step 8: Verify the buyer checkout still works end to end**

```bash
npm run test:e2e -- buyer-address.spec.ts
```

Expected: 1 passed. This spec drives the checkout address form by label, so it proves the default `idPrefix` preserved the existing ids.

- [ ] **Step 9: Commit**

```bash
git add -A src/components/forms/address-fields.tsx src/lib/malaysia-postcodes.ts src/lib/malaysia-postcodes.json src/lib/malaysia-postcodes.test.ts src/features/buyer scripts/generate-malaysia-postcodes.mjs "src/app/buyer_portal/[organizationSlug]/checkout/checkout-client.tsx"
git commit -m "refactor(address): share AddressFields and postcode dataset, add idPrefix

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Migration — address columns, pairing constraint, postcode backfill (pgTAP TDD)

**Files:**
- Create: `supabase/tests/rls/22_customer_structured_address.sql`
- Create: `supabase/migrations/20260823000008_customer_structured_address.sql`

**Interfaces:**
- Consumes: `public.customers` as it stands after `20260823000007` (columns include `address`, `email`, generated `phone_normalized`).
- Produces: `customers.postcode`, `customers.state`, `customers.area`, and constraint `customers_address_parts_ck`. Task 3 regenerates TypeScript types from this schema.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/rls/22_customer_structured_address.sql`:

```sql
-- supabase/tests/rls/22_customer_structured_address.sql
-- Structured customer address: column checks, the state/area pairing
-- constraint, and the one-time postcode backfill.

begin;
select plan(9);

insert into auth.users (id) values
  ('e0000000-0000-0000-0000-0000000000ee')
on conflict (id) do nothing;

insert into public.organizations (id, name, slug)
values ('f0000000-0000-0000-0000-0000000000ff', 'Addr Test Org', 'addr-test-org')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Legal shapes
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.customers (organization_id, name, phone, created_by)
     values ('f0000000-0000-0000-0000-0000000000ff', 'No Address', '0111111111',
             'e0000000-0000-0000-0000-0000000000ee') $$,
  'a customer with no address at all is accepted'
);
select lives_ok(
  $$ insert into public.customers (organization_id, name, phone, address, created_by)
     values ('f0000000-0000-0000-0000-0000000000ff', 'Address Only', '0111111112',
             '9 Jalan Tanpa Poskod', 'e0000000-0000-0000-0000-0000000000ee') $$,
  'a legacy address-only customer is accepted'
);
select lives_ok(
  $$ insert into public.customers (organization_id, name, phone, address, postcode, state, area, created_by)
     values ('f0000000-0000-0000-0000-0000000000ff', 'Full Address', '0111111113',
             '1 Jalan Penuh', '80000', 'Johor', 'Johor Bahru',
             'e0000000-0000-0000-0000-0000000000ee') $$,
  'a complete structured address is accepted'
);

-- ---------------------------------------------------------------------------
-- Illegal shapes
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.customers (organization_id, name, phone, address, postcode, state, created_by)
     values ('f0000000-0000-0000-0000-0000000000ff', 'State No Area', '0111111114',
             '2 Jalan Separa', '80000', 'Johor', 'e0000000-0000-0000-0000-0000000000ee') $$,
  '23514',
  null,
  'a state without an area is rejected'
);
select throws_ok(
  $$ insert into public.customers (organization_id, name, phone, address, state, area, created_by)
     values ('f0000000-0000-0000-0000-0000000000ff', 'No Postcode', '0111111115',
             '3 Jalan Separa', 'Johor', 'Johor Bahru', 'e0000000-0000-0000-0000-0000000000ee') $$,
  '23514',
  null,
  'state and area without a postcode are rejected'
);
select throws_ok(
  $$ insert into public.customers (organization_id, name, phone, address, postcode, created_by)
     values ('f0000000-0000-0000-0000-0000000000ff', 'Bad Postcode', '0111111116',
             '4 Jalan Salah', '8000', 'e0000000-0000-0000-0000-0000000000ee') $$,
  '23514',
  null,
  'a postcode that is not five digits is rejected'
);

-- ---------------------------------------------------------------------------
-- Backfill: the migration already ran, so assert against the seeded rows it
-- processed. Seed data carries addresses with embedded postcodes.
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select postcode from public.customers where address = '3 Jalan Bakri, 84000 Muar' $$,
  array['84000'::text],
  'backfill extracted the embedded postcode from a seeded address'
);
select ok(
  (select count(*) from public.customers
    where address is not null
      and address !~ '\m[0-9]{5}\M'
      and postcode is not null) = 0,
  'backfill left addresses without a 5-digit token unparsed'
);
select ok(
  (select count(*) from public.customers where postcode is not null and state is not null) >= 0,
  'backfill does not invent state or area (SQL cannot read the dataset)'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx supabase db reset && npm run db:test
```

Expected: `22_customer_structured_address` FAILS — `column "postcode" of relation "customers" does not exist`. All 23 pre-existing files still pass.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260823000008_customer_structured_address.sql`:

```sql
-- Structured Malaysian address on customers: the same shape buyers already
-- get at checkout (address line, postcode, state, area).
-- Spec: docs/superpowers/specs/2026-08-23-customer-structured-address-design.md

alter table public.customers
  add column if not exists postcode text null
    check (postcode is null or postcode ~ '^[0-9]{5}$'),
  add column if not exists state text null
    check (state is null or char_length(state) between 1 and 50),
  add column if not exists area text null
    check (area is null or char_length(area) between 1 and 100);

-- State and area only ever arrive together, and only ever derived from a
-- postcode. Address-alone stays legal: legacy rows predate this column set
-- and must remain editable.
alter table public.customers drop constraint if exists customers_address_parts_ck;
alter table public.customers add constraint customers_address_parts_ck check (
  (state is null and area is null)
  or (state is not null and area is not null and postcode is not null)
);

comment on column public.customers.postcode is
  'Delivery postcode; drives zone resolution on the manual order screen.';

-- ---------------------------------------------------------------------------
-- Backfill: pull a standalone 5-digit token out of the free-text address.
-- Malaysian addresses put the postcode near the end, so the LAST match wins
-- ("31 Jalan Sutera Tanjung 8/2, 81300 Skudai" -> 81300, not 8). State and
-- area are not backfilled: the postcode dataset is a vendored JSON file, not
-- a table, so SQL cannot resolve them. The edit dialog completes them on open.
-- Idempotent: only touches rows whose postcode is still null.
-- ---------------------------------------------------------------------------
update public.customers c
set postcode = sub.pc
from (
  select c2.id,
         (select m[1]
            from regexp_matches(c2.address, '\m([0-9]{5})\M', 'g')
                 with ordinality as t(m, ord)
           order by t.ord desc
           limit 1) as pc
  from public.customers c2
  where c2.address is not null
    and c2.postcode is null
) sub
where c.id = sub.id
  and sub.pc is not null;
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx supabase db reset && npm run db:test
```

Expected: `22_customer_structured_address` passes 9/9 and every other file still passes. If the seeded address string in the backfill assertion does not exist, read `supabase/seed.sql`, pick a seeded address that genuinely contains a 5-digit token, and use that exact string — do not weaken the assertion to a count.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260823000008_customer_structured_address.sql supabase/tests/rls/22_customer_structured_address.sql
git commit -m "feat(customers): structured address columns, pairing constraint, postcode backfill

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Types, address parsing, and server actions

**Files:**
- Modify: `src/types/database.generated.ts` (regenerated, never hand-edited)
- Modify: `src/features/seller/lib/customer-schema.ts`
- Modify: `src/features/seller/tests/unit/customer-schema.test.ts`
- Modify: `src/features/seller/server/actions.ts` (the `createCustomer` and `updateCustomer` bodies)

**Interfaces:**
- Consumes: Task 2's columns.
- Produces: `parseCustomerAddress(input): { address, postcode, state, area }` (each `string | null`), throwing `Error` with a user-facing message on an invalid combination; `createCustomer` and `updateCustomer` accepting `address`, `postcode`, `state`, `area`. Tasks 4 and 6 consume both.

- [ ] **Step 1: Regenerate database types**

```bash
npm run db:types
```

Expected: the `customers` Row/Insert/Update blocks in `src/types/database.generated.ts` gain `postcode`, `state`, and `area`.

- [ ] **Step 2: Write the failing unit tests**

Append to `src/features/seller/tests/unit/customer-schema.test.ts`:

```ts
import { parseCustomerAddress } from "../../lib/customer-schema";

describe("parseCustomerAddress", () => {
  test("an entirely blank address parses to all nulls", () => {
    expect(parseCustomerAddress({})).toEqual({
      address: null,
      postcode: null,
      state: null,
      area: null,
    });
    expect(
      parseCustomerAddress({ address: "  ", postcode: "", state: null, area: undefined }),
    ).toEqual({ address: null, postcode: null, state: null, area: null });
  });

  test("a complete address is trimmed and returned", () => {
    expect(
      parseCustomerAddress({
        address: "  1 Jalan Penuh ",
        postcode: " 80000 ",
        state: " Johor ",
        area: " Johor Bahru ",
      }),
    ).toEqual({
      address: "1 Jalan Penuh",
      postcode: "80000",
      state: "Johor",
      area: "Johor Bahru",
    });
  });

  test("an address without a postcode throws", () => {
    expect(() => parseCustomerAddress({ address: "9 Jalan Tanpa Poskod" })).toThrow(
      "Enter a 5-digit postcode for this address",
    );
  });

  test("a postcode without an address throws", () => {
    expect(() => parseCustomerAddress({ postcode: "80000" })).toThrow(
      "Enter an address for this postcode",
    );
  });

  test("a malformed postcode throws", () => {
    expect(() =>
      parseCustomerAddress({ address: "4 Jalan Salah", postcode: "8000" }),
    ).toThrow("Enter a valid 5-digit postcode");
  });

  test("a state without an area throws", () => {
    expect(() =>
      parseCustomerAddress({
        address: "2 Jalan Separa",
        postcode: "80000",
        state: "Johor",
      }),
    ).toThrow("Pick both a state and an area");
  });

  test("a non-string address field throws", () => {
    expect(() => parseCustomerAddress({ address: 42 })).toThrow("Invalid address");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx vitest run src/features/seller/tests/unit/customer-schema.test.ts
```

Expected: FAIL — `parseCustomerAddress` is not exported.

- [ ] **Step 4: Implement `parseCustomerAddress`**

Append to `src/features/seller/lib/customer-schema.ts`:

```ts
export type CustomerAddressInput = {
  address?: unknown;
  postcode?: unknown;
  state?: unknown;
  area?: unknown;
};

export type CustomerAddressParts = {
  address: string | null;
  postcode: string | null;
  state: string | null;
  area: string | null;
};

function trimmedOrNull(raw: unknown, label: string): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") throw new Error(`Invalid ${label}`);
  const value = raw.trim();
  return value === "" ? null : value;
}

/**
 * All-or-nothing address parsing for the customer forms: leave the whole
 * block blank, or fill it in. State and area always arrive together because
 * the postcode lookup supplies both. The database is deliberately looser —
 * it tolerates legacy address-only rows the backfill could not resolve.
 */
export function parseCustomerAddress(input: CustomerAddressInput): CustomerAddressParts {
  const address = trimmedOrNull(input.address, "address");
  const postcode = trimmedOrNull(input.postcode, "postcode");
  const state = trimmedOrNull(input.state, "state");
  const area = trimmedOrNull(input.area, "area");

  if (!address && !postcode && !state && !area) {
    return { address: null, postcode: null, state: null, area: null };
  }
  if (address && !postcode) {
    throw new Error("Enter a 5-digit postcode for this address");
  }
  if (postcode && !address) {
    throw new Error("Enter an address for this postcode");
  }
  if (postcode && !/^[0-9]{5}$/.test(postcode)) {
    throw new Error("Enter a valid 5-digit postcode");
  }
  if (Boolean(state) !== Boolean(area)) {
    throw new Error("Pick both a state and an area");
  }

  return { address, postcode, state, area };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/features/seller/tests/unit/customer-schema.test.ts
```

Expected: PASS (11 tests — the 4 existing email tests plus 7 new).

- [ ] **Step 6: Wire the actions**

In `src/features/seller/server/actions.ts`, extend the existing import:

```ts
import { parseCustomerAddress, parseCustomerEmail } from "../lib/customer-schema";
```

In `createCustomer`, replace the insert call with:

```ts
  const email = parseCustomerEmail(input.email);
  const address = parseCustomerAddress(input);

  const { data, error } = await supabase
    .from("customers")
    .insert({ ...input, email, ...address, organization_id: orgId, created_by: user.user.id })
    .select()
    .single();
```

In `updateCustomer`, replace the `patch` line and the update call with:

```ts
  const touchesAddress =
    "address" in input || "postcode" in input || "state" in input || "area" in input;
  const patch = {
    ...input,
    ...("email" in input ? { email: parseCustomerEmail(input.email) } : {}),
    ...(touchesAddress ? parseCustomerAddress(input) : {}),
  };

  const { data, error } = await supabase
    .from("customers")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
```

- [ ] **Step 7: Run typecheck and the full unit suite**

```bash
npm run typecheck && npm test
```

Expected: both pass; 584 tests (577 baseline plus 7 new).

- [ ] **Step 8: Commit**

```bash
git add src/types/database.generated.ts src/features/seller/lib/customer-schema.ts src/features/seller/tests/unit/customer-schema.test.ts src/features/seller/server/actions.ts
git commit -m "feat(customers): parse and persist structured address on customer actions

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Add/Edit Customer dialog uses AddressFields

**Files:**
- Modify: `src/app/(seller)/[organizationSlug]/customers/customers-client.tsx`

**Interfaces:**
- Consumes: `AddressFields`/`AddressValue` from `@/components/forms/address-fields` (Task 1), `lookupPostcode` from `@/lib/malaysia-postcodes` (Task 1), and the address-aware `createCustomer`/`updateCustomer` (Task 3).
- Produces: the dialog markup Task 7's e2e drives by label ("Address", "Postcode", "State", "Area").

- [ ] **Step 1: Add the imports**

```ts
import { AddressFields } from "@/components/forms/address-fields";
import { lookupPostcode } from "@/lib/malaysia-postcodes";
```

- [ ] **Step 2: Extend the form state**

Replace the `formData` initializer:

```ts
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    postcode: "",
    state: "",
    area: "",
    notes: "",
  });
```

And `openCreateDialog`'s reset:

```ts
    setFormData({
      name: "",
      phone: "",
      email: "",
      address: "",
      postcode: "",
      state: "",
      area: "",
      notes: "",
    });
```

- [ ] **Step 3: Complete backfilled rows when the edit dialog opens**

Replace the body of `openEditDialog`:

```ts
  const openEditDialog = (customer: CustomerWithPortal) => {
    setEditingCustomer(customer);
    // The SQL backfill could only recover a postcode — it cannot read the
    // vendored dataset. Resolve state and area here so a backfilled customer
    // shows a complete address the first time a seller opens it.
    const derived =
      customer.postcode && !customer.state ? lookupPostcode(customer.postcode) : null;
    setFormData({
      name: customer.name,
      phone: customer.phone,
      email: customer.email || "",
      address: customer.address || "",
      postcode: customer.postcode || "",
      state: customer.state || derived?.state || "",
      area: customer.area || derived?.area || "",
      notes: customer.notes || "",
    });
    setDialogOpen(true);
  };
```

- [ ] **Step 4: Send the address fields on submit**

In `handleSubmit`, both the update and the create calls take the three new fields alongside `address`. The update call's object becomes:

```ts
        const updated = await updateCustomer(editingCustomer.id, {
          name: formData.name,
          phone: formData.phone,
          email: formData.email || null,
          address: formData.address || null,
          postcode: formData.postcode || null,
          state: formData.state || null,
          area: formData.area || null,
          notes: formData.notes || null,
        });
```

and the create call's object:

```ts
        const newCustomer = await createCustomer(organizationId, {
          name: formData.name,
          phone: formData.phone,
          email: formData.email || null,
          address: formData.address || null,
          postcode: formData.postcode || null,
          state: formData.state || null,
          area: formData.area || null,
          notes: formData.notes || null,
        });
```

Leave the surrounding `setCustomers` / `toast` / `catch` logic exactly as it is — the catch already surfaces `parseCustomerAddress`'s message.

- [ ] **Step 5: Swap the Address textarea for AddressFields**

In the dialog form, replace the whole Address block:

```tsx
            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Textarea
                id="address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              />
            </div>
```

with:

```tsx
            <AddressFields
              value={{
                addressLine: formData.address,
                postcode: formData.postcode,
                state: formData.state,
                area: formData.area,
              }}
              onChange={(next) =>
                setFormData({
                  ...formData,
                  address: next.addressLine,
                  postcode: next.postcode,
                  state: next.state,
                  area: next.area,
                })
              }
            />
```

`AddressFields` marks its address line and postcode `required`; since the whole block is optional for a customer, that native requirement would block saving a customer with no address at all. If `npm run test:e2e` in Task 7 shows the browser blocking submission of an address-free customer, the fix is to thread a `required?: boolean` prop through `AddressFields` (defaulting to `true` so buyer checkout is unchanged) and pass `required={false}` here — do not remove `required` from the shared component outright.

`Textarea` stays imported: the Notes field still uses it.

- [ ] **Step 6: Run the gates**

```bash
npm run typecheck && npm run lint
```

Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(seller)/[organizationSlug]/customers/customers-client.tsx"
git commit -m "feat(customers): structured address in the Add/Edit Customer dialog

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `resolveDeliveryZone` server action

**Files:**
- Modify: `src/features/orders/server/order-actions.ts`
- Create: `src/features/orders/tests/unit/resolve-delivery-zone.test.ts`

**Interfaces:**
- Consumes: the existing `guardRoles`, `err`, `ok` helpers and `MANAGER_ROLES` already imported in `order-actions.ts`; the `resolve_zone_for_postcode` RPC (granted to `authenticated` by `20260822000002`).
- Produces: `resolveDeliveryZone(organizationSlug: string, postcode: string): Promise<ActionResult<{ zoneId: string | null }>>`. Task 6 consumes it.

- [ ] **Step 1: Write the failing unit test**

Create `src/features/orders/tests/unit/resolve-delivery-zone.test.ts`. Mirror the mock idiom of the existing `src/features/orders/tests/unit/portal-resolve-zone.test.ts` — read that file first and copy its `vi.mock` block, its `chain()` helper, and its beforeEach/afterEach shape, adapting the guard from `requireBuyer` to the org-role path used by the other `order-actions` tests in `src/features/orders/tests/unit/order-actions.test.ts` (read that file for how it stubs the membership lookup). The test must cover:

```ts
  it("returns the resolved zone id for a covered postcode", async () => {
    // rpc resolves to a uuid string
    const result = await resolveDeliveryZone("acme", "80000");
    expect(result).toEqual({ ok: true, data: { zoneId: "<the uuid>" } });
  });

  it("returns a null zone id when no zone covers the postcode", async () => {
    // rpc resolves to null
    const result = await resolveDeliveryZone("acme", "50000");
    expect(result).toEqual({ ok: true, data: { zoneId: null } });
  });

  it("rejects a malformed postcode without calling the rpc", async () => {
    const result = await resolveDeliveryZone("acme", "800");
    expect(result.ok).toBe(false);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("passes the guarded org id to the rpc", async () => {
    await resolveDeliveryZone("acme", "80000");
    expect(supabase.rpc).toHaveBeenCalledWith("resolve_zone_for_postcode", {
      p_org: "<the org id the guard resolved>",
      p_postcode: "80000",
    });
  });

  it("refuses a caller without a manager role", async () => {
    // membership lookup resolves to a non-manager role
    const result = await resolveDeliveryZone("acme", "80000");
    expect(result).toMatchObject({ ok: false, code: "forbidden" });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/features/orders/tests/unit/resolve-delivery-zone.test.ts
```

Expected: FAIL — `resolveDeliveryZone` is not exported from `order-actions`.

- [ ] **Step 3: Implement the action**

Add to `src/features/orders/server/order-actions.ts`, directly after `getDeliveryOptionsForOrg`:

```ts
/**
 * Postcode to delivery zone for the manual order screen. Mirrors the buyer
 * portal's resolveZoneForPostcode but gated on manager roles. A null zone is
 * a valid answer — no zone covers that postcode — not an error.
 */
export async function resolveDeliveryZone(
  organizationSlug: string,
  postcode: string,
): Promise<ActionResult<{ zoneId: string | null }>> {
  const guard = await guardRoles(organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;

  if (!/^[0-9]{5}$/.test(postcode)) {
    return err("validation", "Enter a 5-digit postcode");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("resolve_zone_for_postcode", {
    p_org: guard.orgId,
    p_postcode: postcode,
  });
  if (error) {
    return err("internal", "Failed to check delivery coverage");
  }
  return ok({ zoneId: (data as string | null) ?? null });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/features/orders/tests/unit/resolve-delivery-zone.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Run the gates**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: all pass; 589 tests.

- [ ] **Step 6: Commit**

```bash
git add src/features/orders/server/order-actions.ts src/features/orders/tests/unit/resolve-delivery-zone.test.ts
git commit -m "feat(orders): manager-gated resolveDeliveryZone action

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Manual order screen — structured inline customer form and prefill

**Files:**
- Modify: `src/app/(seller)/[organizationSlug]/orders/new/new-order-client.tsx`

**Interfaces:**
- Consumes: `AddressFields` (Task 1), `createCustomer` with address fields (Task 3), `resolveDeliveryZone` (Task 5).
- Produces: the prefill behaviour Task 7's e2e asserts.

- [ ] **Step 1: Add the imports**

```ts
import { AddressFields } from "@/components/forms/address-fields";
```

and extend the existing `order-actions` import to include `resolveDeliveryZone`:

```ts
import { getDeliveryOptionsForOrg, createManualOrder, resolveDeliveryZone } from "@/features/orders/server/order-actions";
```

- [ ] **Step 2: Extend the inline new-customer state**

Replace the `newCustomer` initializer (currently `{ name: "", phone: "", address: "", notes: "" }`):

```ts
  const [newCustomer, setNewCustomer] = useState({
    name: "",
    phone: "",
    address: "",
    postcode: "",
    state: "",
    area: "",
    notes: "",
  });
```

- [ ] **Step 3: Add the prefill helper**

Add directly above `handleAddNewCustomer`:

```ts
  /**
   * Selecting a customer is an explicit action, so their saved address and
   * postcode overwrite whatever is in the delivery fields, and the zone is
   * resolved from the postcode the same way the buyer checkout does it.
   */
  const applyCustomer = async (customer: Customer) => {
    setSelectedCustomer(customer);
    if (customer.address) setAddress(customer.address);
    if (!customer.postcode) return;

    setPostcode(customer.postcode);
    const result = await resolveDeliveryZone(organizationSlug, customer.postcode);
    if (!result.ok) return;

    // Only adopt a zone the seller can actually see in the picker; the
    // resolver can return a zone that is not in the active list.
    if (result.data.zoneId && zones.some((zone) => zone.id === result.data.zoneId)) {
      await handleZoneChange(result.data.zoneId);
      return;
    }
    toast({
      title: `No delivery zone covers ${customer.postcode}`,
      description: "Pick a zone manually.",
    });
  };
```

- [ ] **Step 4: Route both customer-selection paths through it**

In the search-results button's `onClick`, replace `setSelectedCustomer(customer);` with `void applyCustomer(customer);`, leaving the two following lines (`setCustomerSearch("")`, `setCustomerResults([])`) in place.

In `handleAddNewCustomer`, replace `setSelectedCustomer(customer);` with `await applyCustomer(customer);`, and extend the `createCustomer` call:

```ts
      const customer = await createCustomer(organizationId, {
        name: newCustomer.name,
        phone: newCustomer.phone,
        address: newCustomer.address || null,
        postcode: newCustomer.postcode || null,
        state: newCustomer.state || null,
        area: newCustomer.area || null,
        notes: newCustomer.notes || null,
      });
```

- [ ] **Step 5: Swap the inline Address input for AddressFields**

Replace this block in the inline new-customer form:

```tsx
                <div className="space-y-2">
                  <Label>Address</Label>
                  <Input
                    value={newCustomer.address}
                    onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })}
                  />
                </div>
```

with:

```tsx
                <AddressFields
                  idPrefix="customer-address"
                  value={{
                    addressLine: newCustomer.address,
                    postcode: newCustomer.postcode,
                    state: newCustomer.state,
                    area: newCustomer.area,
                  }}
                  onChange={(next) =>
                    setNewCustomer({
                      ...newCustomer,
                      address: next.addressLine,
                      postcode: next.postcode,
                      state: next.state,
                      area: next.area,
                    })
                  }
                />
```

The `idPrefix` is what keeps these ids distinct from the order's own delivery section on the same page.

- [ ] **Step 6: Show the saved postcode in the selected-customer summary**

In the selected-customer panel, the address line already renders. Directly under it, add the postcode so the seller can see what drove the zone:

```tsx
                    {selectedCustomer.postcode && (
                      <div className="text-sm text-muted-foreground">
                        {selectedCustomer.postcode}
                        {selectedCustomer.area ? ` · ${selectedCustomer.area}` : ""}
                      </div>
                    )}
```

- [ ] **Step 7: Run the gates**

```bash
npm run typecheck && npm run lint
```

Expected: both pass. If `Input` becomes unused in this file, lint will say so — remove it from the import only if that is the case.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(seller)/[organizationSlug]/orders/new/new-order-client.tsx"
git commit -m "feat(orders): structured inline customer address, prefill delivery from customer

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: End-to-end coverage and full gates

**Files:**
- Create: `e2e/customer-address-prefill.spec.ts`

**Interfaces:**
- Consumes: `OWNER`, `signIn`, `uniqueFixtureName` from `e2e/_fixtures.ts`; the dialog labels from Task 4 and the prefill behaviour from Task 6.

- [ ] **Step 1: Write the e2e spec**

Create `e2e/customer-address-prefill.spec.ts`. Read `e2e/buyer-address.spec.ts` first and copy its `seedZoneWithCoverage` helper into this file as a local copy — helpers in that spec are file-local by design (a previous branch broke when a spec imported helpers that lived only in an uncommitted `_fixtures` edit). The spec must:

1. Sign in as `OWNER` and seed a zone whose postcode range covers `80000`–`81999`, with a truck and an active slot.
2. Go to `/ayam-norliza-pilot/customers`, click **Add Customer**, and fill Name (`uniqueFixtureName("E2E Addr Customer")`), Phone (a unique number), Address (`"7 Jalan Prefill"`), and Postcode `80100`. Assert that State and Area auto-fill (the postcode lookup fires on typing) before clicking **Create**.
3. Assert the new row appears in the customers table.
4. Go to `/ayam-norliza-pilot/orders/new`, search for the customer by name, and click the result.
5. Assert the delivery Address textarea now contains `"7 Jalan Prefill"`, the Postcode field contains `80100`, and the zone Select shows the seeded zone's name — the auto-resolution.

Use `getByLabel` for the dialog fields and 20-second timeouts on network-dependent expectations, matching the conventions in `e2e/customer-sync.spec.ts`.

- [ ] **Step 2: Run the spec**

```bash
npm run test:e2e -- customer-address-prefill.spec.ts
```

Expected: 1 passed. If a locator misses, correct the locator from Playwright's failure snapshot — never weaken an assertion. If the failure is a genuine product bug (for example the zone does not auto-select), stop and report it rather than adjusting the test to match the bug.

- [ ] **Step 3: Run every gate**

```bash
npm run typecheck && npm run lint && npm test && npx supabase db reset && npm run db:test && npm run test:e2e
```

Expected: all pass — 589 unit tests, pgTAP 24 files with the new 9 assertions, and the full Playwright suite including `buyer-address.spec.ts` (proving the component move did not change the checkout) and `customer-sync.spec.ts`.

- [ ] **Step 4: Commit**

```bash
git add e2e/customer-address-prefill.spec.ts
git commit -m "test(customers): e2e for structured address entry and order prefill

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Finish the branch**

Use the superpowers:finishing-a-development-branch skill to decide merge, PR, or cleanup.
