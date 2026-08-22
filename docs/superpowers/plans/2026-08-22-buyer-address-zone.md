# Buyer Signup Phone, Address Book & Auto Zone Resolution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Buyers sign up with a phone number, save reusable structured Malaysian addresses, and get their delivery zone resolved automatically from the postcode — the zone dropdown disappears from checkout.

**Architecture:** Next.js App Router + Supabase. New `buyer_addresses` table (RLS: own rows only) and a security-definer RPC `resolve_zone_for_postcode` over the existing `zone_postcode_ranges` table. A vendored Malaysia postcode→(area, state) JSON dataset powers client-side auto-fill. Checkout becomes a server-gated page (`page.tsx` wrapper + `checkout-client.tsx`) matching the delivery-page pattern.

**Tech Stack:** Next.js 15 (App Router, Server Actions), Supabase (Postgres, RLS, pgTAP via `supabase test db`), Zod, Vitest, Playwright.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-22-buyer-address-zone-design.md`.
- ActionResult error shape everywhere: `{ ok: false, code, message, fieldErrors? }` / `{ ok: true, data }` — copy the `err`/`ok` helper pattern from `src/features/orders/server/portal-actions.ts`.
- Postcode regex everywhere: `^[0-9]{5}$`.
- Phone stored E.164: `+601XXXXXXXX` (10–11 national digits starting `01`).
- `place_order` RPC is NOT modified.
- The working tree has unrelated uncommitted changes (`e2e/_fixtures.ts`, `e2e/invite.spec.ts`, `src/app/page.tsx`, `src/features/identity-access/server/auth-actions.ts`, `src/features/identity-access/server/landing.ts`, `docs/client/`). NEVER `git add -A` — stage only the files named in each commit step.
- Local DB commands: `npm run db:reset` (applies migrations), `npm run db:types` (regenerates `src/types/database.generated.ts`), `npm run db:test` (pgTAP).
- Verify with `npm run typecheck` and `npm run test` before each commit that touches TS.

---

### Task 1: Migration — `buyer_addresses` table + `resolve_zone_for_postcode` RPC

**Files:**
- Create: `supabase/migrations/20260822000002_buyer_addresses_zone_resolve.sql`
- Create: `supabase/tests/rls/17_buyer_addresses.sql`
- Modify (generated): `src/types/database.generated.ts` via `npm run db:types`

**Interfaces:**
- Produces: table `public.buyer_addresses(id, buyer_id, address_line, postcode, state, area, is_default, created_at, updated_at)`; RPC `public.resolve_zone_for_postcode(p_org uuid, p_postcode text) returns uuid` (null when no active zone covers the postcode; raises `invalid_postcode` on malformed input). Both used by Tasks 5–6.

- [ ] **Step 1: Write the migration**

```sql
-- 20260822000002_buyer_addresses_zone_resolve.sql
-- Buyer address book + postcode→zone resolution for the buyer portal.
-- Zones stay seller-defined; zone_postcode_ranges (existing) provides the
-- mapping. Overlap tie-break: first match by zone name, matching the
-- zone_postcode_ranges table comment.

begin;

-- ---------------------------------------------------------------------------
-- buyer_addresses
-- ---------------------------------------------------------------------------
create table if not exists public.buyer_addresses (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.buyers(id) on delete cascade,
  address_line text not null check (char_length(address_line) between 1 and 500),
  postcode text not null check (postcode ~ '^[0-9]{5}$'),
  state text not null check (char_length(state) between 1 and 50),
  area text not null check (char_length(area) between 1 and 100),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists buyer_addresses_buyer_idx on public.buyer_addresses(buyer_id);
create unique index if not exists buyer_addresses_one_default_idx
  on public.buyer_addresses(buyer_id) where is_default;

comment on table public.buyer_addresses is 'Saved delivery addresses per buyer; at most one default each.';

drop trigger if exists buyer_addresses_updated_at on public.buyer_addresses;
create trigger buyer_addresses_updated_at before update on public.buyer_addresses
  for each row execute function public.set_updated_at();

alter table public.buyer_addresses enable row level security;

create policy "buyer_addresses_select_own" on public.buyer_addresses
  for select using (buyer_id = auth.uid());
create policy "buyer_addresses_insert_own" on public.buyer_addresses
  for insert with check (buyer_id = auth.uid());
create policy "buyer_addresses_update_own" on public.buyer_addresses
  for update using (buyer_id = auth.uid()) with check (buyer_id = auth.uid());
create policy "buyer_addresses_delete_own" on public.buyer_addresses
  for delete using (buyer_id = auth.uid());

grant select, insert, update, delete on public.buyer_addresses to authenticated;

-- ---------------------------------------------------------------------------
-- resolve_zone_for_postcode
-- ---------------------------------------------------------------------------
create or replace function public.resolve_zone_for_postcode(
  p_org uuid,
  p_postcode text
)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_zone uuid;
begin
  if p_postcode is null or p_postcode !~ '^[0-9]{5}$' then
    raise exception using errcode = 'P0001', message = 'invalid_postcode';
  end if;

  select z.id
    into v_zone
  from public.zone_postcode_ranges r
  join public.delivery_zones z
    on z.id = r.zone_id
   and z.is_active = true
  where r.organization_id = p_org
    and r.postcode_start <= p_postcode
    and r.postcode_end >= p_postcode
  order by z.name asc
  limit 1;

  return v_zone; -- null when no match: "no delivery to your area"
end;
$$;

revoke all on function public.resolve_zone_for_postcode(uuid, text) from public;
grant execute on function public.resolve_zone_for_postcode(uuid, text) to authenticated;

commit;
```

- [ ] **Step 2: Write the pgTAP test** (`supabase/tests/rls/17_buyer_addresses.sql`, following `00_template.sql` / `08_order_rpcs.sql` style)

```sql
-- supabase/tests/rls/17_buyer_addresses.sql
-- buyer_addresses RLS: buyers see only their own rows; anon sees nothing.
-- resolve_zone_for_postcode: match, no-match, malformed input.

begin;
select plan(7);

-- Seed: an org, two buyer auth users, a zone with a postcode range.
insert into auth.users (id, email)
values
  ('a0000000-0000-0000-0000-00000000000a', 'buyer-a@test.local'),
  ('b0000000-0000-0000-0000-00000000000b', 'buyer-b@test.local');

insert into public.organizations (id, name, slug)
values ('c0000000-0000-0000-0000-00000000000c', 'AddrTest Org', 'addrtest-org');

insert into public.buyers (id, organization_id, display_name)
values
  ('a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000c', 'Buyer A'),
  ('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-00000000000c', 'Buyer B');

insert into public.buyer_addresses (id, buyer_id, address_line, postcode, state, area, is_default)
values ('d0000000-0000-0000-0000-00000000000d', 'a0000000-0000-0000-0000-00000000000a',
        '1 Jalan Test', '80000', 'Johor', 'Johor Bahru', true);

insert into public.delivery_zones (id, organization_id, name)
values ('e0000000-0000-0000-0000-00000000000e', 'c0000000-0000-0000-0000-00000000000c', 'Zone JB');

insert into public.zone_postcode_ranges (organization_id, zone_id, postcode_start, postcode_end)
values ('c0000000-0000-0000-0000-00000000000c', 'e0000000-0000-0000-0000-00000000000e', '80000', '81999');

-- Buyer A sees own row.
set local role authenticated;
set local request.jwt.claims to '{"sub": "a0000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select results_eq(
  $$ select count(*)::int from public.buyer_addresses $$,
  array[1],
  'buyer sees own addresses'
);

-- Buyer B sees none of A's rows and cannot insert as A.
set local request.jwt.claims to '{"sub": "b0000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select results_eq(
  $$ select count(*)::int from public.buyer_addresses $$,
  array[0],
  'other buyer sees nothing'
);
select throws_ok(
  $$ insert into public.buyer_addresses (buyer_id, address_line, postcode, state, area)
     values ('a0000000-0000-0000-0000-00000000000a', 'x', '80000', 'Johor', 'JB') $$,
  '42501',
  null,
  'cannot insert an address for another buyer'
);

-- Resolver: hit, miss, malformed.
select results_eq(
  $$ select public.resolve_zone_for_postcode('c0000000-0000-0000-0000-00000000000c', '80100') $$,
  array['e0000000-0000-0000-0000-00000000000e'::uuid],
  'postcode inside range resolves to the zone'
);
select results_eq(
  $$ select public.resolve_zone_for_postcode('c0000000-0000-0000-0000-00000000000c', '50000') $$,
  array[null::uuid],
  'uncovered postcode resolves to null'
);
select throws_ok(
  $$ select public.resolve_zone_for_postcode('c0000000-0000-0000-0000-00000000000c', '123') $$,
  'P0001',
  'invalid_postcode',
  'malformed postcode raises invalid_postcode'
);
reset role;

-- Anon: no grant at all.
set local role anon;
select throws_ok(
  $$ select count(*) from public.buyer_addresses $$,
  '42501',
  null,
  'anon cannot read buyer_addresses'
);
reset role;

select * from finish();
rollback;
```

Note for the implementer: if `auth.users` seeding in existing tests uses more columns (check `supabase/tests/rls/08_order_rpcs.sql` and copy its exact seeding style for users/orgs — including any required `instance_id`/`aud` columns), mirror that style. The two-buyer/one-org/one-zone shape above is the requirement; the seeding idiom follows the existing files.

- [ ] **Step 3: Apply + run DB tests**

Run: `npm run db:reset && npm run db:test`
Expected: migration applies cleanly; all pgTAP files pass including `17_buyer_addresses.sql` (7/7).

- [ ] **Step 4: Regenerate DB types**

Run: `npm run db:types`
Expected: `src/types/database.generated.ts` now contains `buyer_addresses` and `resolve_zone_for_postcode`. `npm run typecheck` passes.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260822000002_buyer_addresses_zone_resolve.sql supabase/tests/rls/17_buyer_addresses.sql src/types/database.generated.ts
git commit -m "feat(db): buyer_addresses table and resolve_zone_for_postcode RPC"
```

---

### Task 2: Phone normalization + signup phone field

**Files:**
- Create: `src/features/buyer-auth/lib/phone.ts`
- Create: `src/features/buyer-auth/tests/unit/phone.test.ts`
- Modify: `src/features/buyer-auth/server/auth-actions.ts` (BuyerSignupInput + insert)
- Modify: `src/app/buyer_portal/[organizationSlug]/login/page.tsx` (phone input on signup form)

**Interfaces:**
- Produces: `normalizeMalaysianMobile(raw: string): string | null` — returns `+601…` E.164 or null. `buyerSignUpAction` now requires `phone` in its input and persists `buyers.phone`.

- [ ] **Step 1: Write failing tests** (`src/features/buyer-auth/tests/unit/phone.test.ts`)

```ts
/**
 * Malaysian mobile normalization. Accepted inputs are local (01…),
 * country-prefixed (601…, +601…) with spaces/dashes/parens tolerated;
 * output is E.164 +601XXXXXXXX (10 or 11 national digits). Anything else
 * is rejected with null.
 */
import { describe, expect, it } from "vitest";
import { normalizeMalaysianMobile } from "../../lib/phone";

describe("normalizeMalaysianMobile", () => {
  it.each([
    ["0123456789", "+60123456789"],
    ["012-345 6789", "+60123456789"],
    ["01133456789", "+601133456789"], // 11-digit mobile
    ["+60123456789", "+60123456789"],
    ["60123456789", "+60123456789"],
    ["+60 12-345 6789", "+60123456789"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeMalaysianMobile(input)).toBe(expected);
  });

  it.each([
    "",             // empty
    "abc",          // letters
    "0323456789",   // landline (03), not mobile
    "012345678",    // too short
    "012345678901", // too long
    "+65 9123 4567" // wrong country
  ])("rejects %s", (input) => {
    expect(normalizeMalaysianMobile(input)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/buyer-auth/tests/unit/phone.test.ts`
Expected: FAIL — cannot resolve `../../lib/phone`.

- [ ] **Step 3: Implement** (`src/features/buyer-auth/lib/phone.ts`)

```ts
/**
 * Malaysian mobile phone normalization for buyer signup. Stored E.164
 * (+601XXXXXXXX) so future WhatsApp messaging needs no reformatting.
 */

/** Returns +601XXXXXXXX (E.164) or null when not a Malaysian mobile. */
export function normalizeMalaysianMobile(raw: string): string | null {
  const digits = raw.replace(/[\s\-().]/g, "").replace(/^\+/, "");
  let national: string;
  if (digits.startsWith("60")) {
    national = "0" + digits.slice(2).replace(/^0/, "");
  } else {
    national = digits;
  }
  // Malaysian mobiles: 01X followed by 7-8 digits (10-11 digits total).
  if (!/^01[0-9]{8,9}$/.test(national)) return null;
  return "+60" + national.slice(1);
}
```

Note: `digits.slice(2).replace(/^0/, "")` guards the `600123…` double-prefix typo; plain `60123456789` slices to `123456789` and gets the `0` re-prefixed. Verify tests still express this exactly.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/features/buyer-auth/tests/unit/phone.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into signup action** (`src/features/buyer-auth/server/auth-actions.ts`)

Add import and extend schema:

```ts
import { normalizeMalaysianMobile } from "../lib/phone";

const BuyerSignupInput = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(150),
  phone: z.string().min(1).max(30),
  organizationSlug: z.string().min(1).max(100),
});
```

Inside `buyerSignUpAction`, after `safeParse` succeeds:

```ts
  const phone = normalizeMalaysianMobile(input.phone);
  if (!phone) {
    return err("validation", "Enter a Malaysian mobile number, e.g. 012-345 6789", {
      phone: ["Enter a Malaysian mobile number, e.g. 012-345 6789"],
    });
  }
```

and extend the buyer insert:

```ts
  const { error: buyerError } = await supabase.from("buyers").insert({
    id: data.user.id,
    organization_id: org.id,
    display_name: input.displayName,
    phone,
  });
```

- [ ] **Step 6: Add the phone field to the signup form** (`login/page.tsx`)

Extend state: `phone: ""` inside `signupData` initializer. Pass `phone: signupData.phone` in the `buyerSignUpAction` call. Insert between the Email and Password fields:

```tsx
              <div className="space-y-2">
                <Label htmlFor="signup-phone">Phone (for WhatsApp)</Label>
                <Input
                  id="signup-phone"
                  type="tel"
                  inputMode="tel"
                  placeholder="012-345 6789"
                  value={signupData.phone}
                  onChange={(e) =>
                    setSignupData({ ...signupData, phone: e.target.value })
                  }
                  required
                />
              </div>
```

On `!result.ok` with `result.fieldErrors?.phone`, show that message as the toast description (fall back to `result.message`).

- [ ] **Step 7: Verify + commit**

Run: `npm run typecheck && npm run test`
Expected: PASS.

```bash
git add src/features/buyer-auth/lib/phone.ts src/features/buyer-auth/tests/unit/phone.test.ts src/features/buyer-auth/server/auth-actions.ts "src/app/buyer_portal/[organizationSlug]/login/page.tsx"
git commit -m "feat(buyer): required Malaysian mobile phone at signup, stored E.164"
```

---

### Task 3: Checkout auth gate + login `next` redirect

**Files:**
- Create: `src/app/buyer_portal/[organizationSlug]/checkout/checkout-client.tsx` (move of current page body)
- Modify: `src/app/buyer_portal/[organizationSlug]/checkout/page.tsx` (becomes server wrapper)
- Modify: `src/app/buyer_portal/[organizationSlug]/login/page.tsx` (honor validated `next` param)

**Interfaces:**
- Consumes: `requireBuyer` from `src/lib/auth/buyer-auth` (throws `NotABuyerError`).
- Produces: signed-out visit to `/buyer_portal/[slug]/checkout` redirects to `/buyer_portal/[slug]/login?next=/buyer_portal/[slug]/checkout`; after login/signup the user lands back on checkout. `checkout-client.tsx` default-exports `CheckoutClient({ organizationSlug }: { organizationSlug: string })` — Task 6 rewrites its internals.

- [ ] **Step 1: Split checkout into server wrapper + client component**

Move the entire current content of `checkout/page.tsx` to `checkout/checkout-client.tsx`, renaming the component to `CheckoutClient` and changing its prop from `params: Promise<…>` to a plain `organizationSlug: string` (delete the `params.then` effect and the `organizationSlug` state; use the prop directly). Keep `"use client"` at top.

New `checkout/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { requireBuyer, NotABuyerError } from "@/lib/auth/buyer-auth";
import CheckoutClient from "./checkout-client";

type CheckoutPageProps = {
  params: Promise<{ organizationSlug: string }>;
};

export default async function CheckoutPage({ params }: CheckoutPageProps) {
  const { organizationSlug } = await params;
  try {
    await requireBuyer();
  } catch (e) {
    if (e instanceof NotABuyerError) {
      const next = encodeURIComponent(`/buyer_portal/${organizationSlug}/checkout`);
      redirect(`/buyer_portal/${organizationSlug}/login?next=${next}`);
    }
    throw e;
  }
  return <CheckoutClient organizationSlug={organizationSlug} />;
}
```

- [ ] **Step 2: Honor `next` in the login page**

In `login/page.tsx` add `useSearchParams` (from `next/navigation`):

```ts
  const searchParams = useSearchParams();
  const rawNext = searchParams.get("next");
  // Same-portal relative paths only — never redirect off-portal or cross-org.
  const nextPath =
    rawNext && rawNext.startsWith(`/buyer_portal/${organizationSlug}/`)
      ? rawNext
      : null;
```

Replace both success redirects (`handleLogin`, `handleSignup`):

```ts
  router.push(nextPath ?? `/buyer_portal/${organizationSlug}/shop`);
  router.refresh();
```

Note: `organizationSlug` starts as `""` until params resolve; `nextPath` must be computed where it is used (inside the handlers) or via `useMemo` on `[rawNext, organizationSlug]` — compute-in-handler is simplest. `useSearchParams` requires the component to be under a `<Suspense>` boundary in Next 15 build; if `npm run build`/typecheck complains, wrap the page's default export: export a thin `export default function LoginPage(props)` that returns `<Suspense><LoginPageInner {...props}/></Suspense>`.

- [ ] **Step 3: Manual verify via dev server**

Run: `npm run dev` (port 9999) — signed-out visit to `http://localhost:9999/buyer_portal/ayam-norliza-pilot/checkout` must land on `/login?next=%2Fbuyer_portal%2Fayam-norliza-pilot%2Fcheckout`. Sign in as the e2e BUYER fixture user → back on checkout.

- [ ] **Step 4: Verify + commit**

Run: `npm run typecheck && npm run test`
Expected: PASS.

```bash
git add "src/app/buyer_portal/[organizationSlug]/checkout/page.tsx" "src/app/buyer_portal/[organizationSlug]/checkout/checkout-client.tsx" "src/app/buyer_portal/[organizationSlug]/login/page.tsx"
git commit -m "feat(buyer): gate checkout behind login with next-param return"
```

---

### Task 4: Malaysia postcode dataset + lookup helpers

**Files:**
- Create: `scripts/generate-malaysia-postcodes.mjs`
- Create: `src/features/buyer/lib/malaysia-postcodes.json` (generated, committed)
- Create: `src/features/buyer/lib/malaysia-postcodes.ts`
- Create: `src/features/buyer/tests/unit/malaysia-postcodes.test.ts`
- Modify: `package.json` (devDependency `malaysia-postcodes`)

**Interfaces:**
- Produces:
  - `lookupPostcode(postcode: string): { state: string; area: string } | null`
  - `statesList(): string[]` (sorted, all states/FTs present in dataset)
  - `areasForState(state: string): string[]` (sorted unique)
  - JSON shape: `{ states: string[], postcodes: Record<string, [areaName: string, stateIndex: number]> }`

- [ ] **Step 1: Install source dataset as dev dependency**

Run: `npm install --save-dev malaysia-postcodes`
Expected: added to `devDependencies` (runtime bundle uses only the vendored JSON, not the package).

- [ ] **Step 2: Write the generator** (`scripts/generate-malaysia-postcodes.mjs`)

```js
/**
 * Generates src/features/buyer/lib/malaysia-postcodes.json from the
 * `malaysia-postcodes` npm dataset. Output is a compact lookup:
 *   { states: string[], postcodes: { "80000": ["Johor Bahru", 0], ... } }
 * A postcode listed under several cities keeps the first occurrence.
 * Run: node scripts/generate-malaysia-postcodes.mjs
 */
import { writeFileSync } from "node:fs";
import { allPostcodes } from "malaysia-postcodes";

if (!Array.isArray(allPostcodes) || allPostcodes.length === 0) {
  throw new Error("Unexpected malaysia-postcodes dataset shape: allPostcodes is not a non-empty array");
}

const states = [];
const postcodes = {};

for (const stateEntry of allPostcodes) {
  if (typeof stateEntry?.name !== "string" || !Array.isArray(stateEntry?.city)) {
    throw new Error(`Unexpected state entry shape: ${JSON.stringify(stateEntry).slice(0, 200)}`);
  }
  const stateIndex = states.push(stateEntry.name) - 1;
  for (const city of stateEntry.city) {
    if (typeof city?.name !== "string" || !Array.isArray(city?.postcode)) {
      throw new Error(`Unexpected city entry shape in ${stateEntry.name}`);
    }
    for (const pc of city.postcode) {
      if (!/^[0-9]{5}$/.test(pc)) continue;
      if (!(pc in postcodes)) postcodes[pc] = [city.name, stateIndex];
    }
  }
}

const out = { states, postcodes };
const count = Object.keys(postcodes).length;
if (count < 2000) {
  throw new Error(`Suspiciously few postcodes generated: ${count}`);
}
writeFileSync(
  new URL("../src/features/buyer/lib/malaysia-postcodes.json", import.meta.url),
  JSON.stringify(out),
);
console.log(`Wrote ${count} postcodes across ${states.length} states.`);
```

If the import fails (package may be CJS-only), switch to `import pkg from "malaysia-postcodes"; const { allPostcodes } = pkg;`. If the shape differs from `{ name, city: [{ name, postcode: [] }] }`, inspect `node -e "const p=require('malaysia-postcodes');console.log(Object.keys(p))"` and adapt the traversal — the OUTPUT shape defined above is the contract and must not change.

- [ ] **Step 3: Generate**

Run: `node scripts/generate-malaysia-postcodes.mjs`
Expected: `Wrote ~2700+ postcodes across 16 states.` File created.

- [ ] **Step 4: Write failing helper tests** (`src/features/buyer/tests/unit/malaysia-postcodes.test.ts`)

```ts
/**
 * Postcode lookup helpers over the vendored dataset. Values asserted here
 * are stable, well-known facts (50000 = Kuala Lumpur; 80000 = Johor
 * Bahru) so the test survives dataset regeneration.
 */
import { describe, expect, it } from "vitest";
import {
  areasForState,
  lookupPostcode,
  statesList,
} from "../../lib/malaysia-postcodes";

describe("lookupPostcode", () => {
  it("resolves a known postcode to state and area", () => {
    const hit = lookupPostcode("80000");
    expect(hit?.state).toBe("Johor");
    expect(hit?.area).toMatch(/Johor Bahru/i);
  });

  it("resolves 50000 to Kuala Lumpur", () => {
    expect(lookupPostcode("50000")?.state).toMatch(/Kuala Lumpur/i);
  });

  it("returns null for unknown or malformed postcodes", () => {
    expect(lookupPostcode("99998")).toBeNull();
    expect(lookupPostcode("123")).toBeNull();
    expect(lookupPostcode("")).toBeNull();
  });
});

describe("statesList", () => {
  it("contains all 16 states and federal territories, sorted", () => {
    const states = statesList();
    expect(states.length).toBe(16);
    expect(states).toEqual([...states].sort());
    expect(states).toContain("Johor");
  });
});

describe("areasForState", () => {
  it("lists sorted unique areas for a state", () => {
    const areas = areasForState("Johor");
    expect(areas.length).toBeGreaterThan(5);
    expect(areas).toEqual([...areas].sort());
    expect(new Set(areas).size).toBe(areas.length);
  });

  it("returns empty for unknown state", () => {
    expect(areasForState("Atlantis")).toEqual([]);
  });
});
```

If the dataset spells federal territories differently (e.g. "Wp Kuala Lumpur"), adjust ONLY the `toMatch` regexes/`toContain` literals to the actual dataset spelling — the count-16 and sortedness assertions stand.

- [ ] **Step 5: Run to verify failure**

Run: `npx vitest run src/features/buyer/tests/unit/malaysia-postcodes.test.ts`
Expected: FAIL — cannot resolve `../../lib/malaysia-postcodes`.

- [ ] **Step 6: Implement helpers** (`src/features/buyer/lib/malaysia-postcodes.ts`)

```ts
/**
 * Lookup helpers over the vendored Malaysia postcode dataset
 * (malaysia-postcodes.json, generated by
 * scripts/generate-malaysia-postcodes.mjs). Used by the checkout address
 * form to auto-fill state/area from a typed postcode and to shortlist
 * area options per state.
 */
import data from "./malaysia-postcodes.json";

type Dataset = {
  states: string[];
  postcodes: Record<string, [string, number]>;
};

const dataset = data as Dataset;

export function lookupPostcode(
  postcode: string,
): { state: string; area: string } | null {
  if (!/^[0-9]{5}$/.test(postcode)) return null;
  const entry = dataset.postcodes[postcode];
  if (!entry) return null;
  const [area, stateIndex] = entry;
  const state = dataset.states[stateIndex];
  if (!state) return null;
  return { state, area };
}

let cachedStates: string[] | null = null;

export function statesList(): string[] {
  cachedStates ??= [...dataset.states].sort((a, b) => a.localeCompare(b));
  return cachedStates;
}

const cachedAreas = new Map<string, string[]>();

export function areasForState(state: string): string[] {
  const hit = cachedAreas.get(state);
  if (hit) return hit;
  const stateIndex = dataset.states.indexOf(state);
  const areas =
    stateIndex === -1
      ? []
      : [
          ...new Set(
            Object.values(dataset.postcodes)
              .filter(([, idx]) => idx === stateIndex)
              .map(([area]) => area),
          ),
        ].sort((a, b) => a.localeCompare(b));
  cachedAreas.set(state, areas);
  return areas;
}
```

If `tsconfig.json` lacks `resolveJsonModule`, add `"resolveJsonModule": true` to its `compilerOptions` (check first — Next.js defaults usually have it).

- [ ] **Step 7: Run tests**

Run: `npx vitest run src/features/buyer/tests/unit/malaysia-postcodes.test.ts`
Expected: PASS (after any FT-spelling adjustments per Step 4 note).

- [ ] **Step 8: Verify + commit**

Run: `npm run typecheck && npm run test`
Expected: PASS.

```bash
git add scripts/generate-malaysia-postcodes.mjs src/features/buyer/lib/malaysia-postcodes.json src/features/buyer/lib/malaysia-postcodes.ts src/features/buyer/tests/unit/malaysia-postcodes.test.ts package.json package-lock.json
git commit -m "feat(buyer): vendored Malaysia postcode dataset with state/area lookup"
```

---

### Task 5: Buyer address server actions

**Files:**
- Create: `src/features/buyer/server/address-actions.ts`
- Create: `src/features/buyer/tests/unit/address-actions.test.ts`
- Modify: `src/features/buyer/types.ts` (add `BuyerAddress`)

**Interfaces:**
- Consumes: `buyer_addresses` table (Task 1), `requireBuyer`/`NotABuyerError` from `@/lib/auth/buyer-auth`, `ActionResult` from `@/features/identity-access/server/actions`.
- Produces (all return `Promise<ActionResult<…>>`):
  - `listMyAddresses(): ActionResult<BuyerAddress[]>` — own addresses, default first then newest.
  - `createAddress(input: { addressLine: string; postcode: string; state: string; area: string; makeDefault?: boolean }): ActionResult<BuyerAddress>` — first-ever address is forced default.
  - `setDefaultAddress(addressId: string): ActionResult<BuyerAddress>`
  - `deleteAddress(addressId: string): ActionResult<{ deletedId: string }>` — if the default was deleted, oldest remaining becomes default.
  - `type BuyerAddress = { id: string; addressLine: string; postcode: string; state: string; area: string; isDefault: boolean; createdAt: string }`

- [ ] **Step 1: Add the type** (`src/features/buyer/types.ts`)

```ts
export type BuyerAddress = {
  id: string;
  addressLine: string;
  postcode: string;
  state: string;
  area: string;
  isDefault: boolean;
  createdAt: string;
};
```

- [ ] **Step 2: Write failing tests** (`src/features/buyer/tests/unit/address-actions.test.ts`)

Copy the mock idiom from `src/features/orders/tests/unit/schedule-actions.test.ts` (module-mock `@/lib/supabase/server`, chainable builder stub, thenable). Mock `auth.getUser` to return the buyer user, and wire `from("buyers")` to return a buyer row so `requireBuyer` passes. Cover:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createAddress,
  deleteAddress,
  listMyAddresses,
  setDefaultAddress,
} from "../../server/address-actions";

// …chain()/mockSupabaseFor helpers copied and trimmed from
// schedule-actions.test.ts: from("buyers") returns a buyer row for
// requireBuyer; from("buyer_addresses") served from tableResults.

describe("address actions", () => {
  afterEach(() => vi.restoreAllMocks());

  it("listMyAddresses returns unauthenticated when signed out", async () => {
    // auth.getUser -> { user: null }
    const result = await listMyAddresses();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unauthenticated");
  });

  it("createAddress rejects a malformed postcode with a field error", async () => {
    const result = await createAddress({
      addressLine: "1 Jalan Test",
      postcode: "123",
      state: "Johor",
      area: "Johor Bahru",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("validation");
      expect(result.fieldErrors?.postcode).toBeTruthy();
    }
  });

  it("createAddress inserts and returns the mapped row", async () => {
    // buyer_addresses insert -> returns row (snake_case);
    // count query (existing addresses) -> 0 so makeDefault is forced true.
    const result = await createAddress({
      addressLine: "1 Jalan Test",
      postcode: "80000",
      state: "Johor",
      area: "Johor Bahru",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.isDefault).toBe(true);
      expect(result.data.postcode).toBe("80000");
    }
  });

  it("setDefaultAddress rejects an id that is not a uuid", async () => {
    const result = await setDefaultAddress("not-a-uuid");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("validation");
  });

  it("deleteAddress returns not_found when the row does not belong to the buyer", async () => {
    // delete -> { data: [], error: null } (RLS filtered)
    const result = await deleteAddress("d0000000-0000-0000-0000-00000000000d");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_found");
  });
});
```

The exact stub wiring is the implementer's job; assertions above are the contract.

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/features/buyer/tests/unit/address-actions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement** (`src/features/buyer/server/address-actions.ts`)

```ts
/**
 * Buyer address book Server Actions. All rows are RLS-scoped to the
 * signed-in buyer (buyer_id = auth.uid()); the default flag is kept
 * unique per buyer by a partial unique index, so every default change
 * first clears the old default in the same action.
 */

"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireBuyer, NotABuyerError } from "@/lib/auth/buyer-auth";
import type { ActionResult } from "@/features/identity-access/server/actions";
import type { BuyerAddress } from "../types";

type AddressErrorCode = "validation" | "unauthenticated" | "not_found" | "internal";

function err<T = never>(
  code: AddressErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): ActionResult<T> {
  return { ok: false, code, message, ...(fieldErrors ? { fieldErrors } : {}) };
}

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

type AddressRow = {
  id: string;
  address_line: string;
  postcode: string;
  state: string;
  area: string;
  is_default: boolean;
  created_at: string;
};

function mapRow(row: AddressRow): BuyerAddress {
  return {
    id: row.id,
    addressLine: row.address_line,
    postcode: row.postcode,
    state: row.state,
    area: row.area,
    isDefault: row.is_default,
    createdAt: row.created_at,
  };
}

const CreateAddressInput = z.object({
  addressLine: z.string().min(1).max(500),
  postcode: z.string().regex(/^[0-9]{5}$/, "Enter a 5-digit postcode"),
  state: z.string().min(1).max(50),
  area: z.string().min(1).max(100),
  makeDefault: z.boolean().optional(),
});

const AddressId = z.string().uuid();

async function guard(): Promise<{ buyerId: string } | ActionResult<never>> {
  try {
    const buyer = await requireBuyer();
    return { buyerId: buyer.id };
  } catch (e) {
    if (e instanceof NotABuyerError) return err("unauthenticated", e.message);
    throw e;
  }
}

export async function listMyAddresses(): Promise<ActionResult<BuyerAddress[]>> {
  const g = await guard();
  if ("ok" in g) return g;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("buyer_addresses")
    .select("*")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) return err("internal", "Failed to load addresses");
  return ok(((data ?? []) as AddressRow[]).map(mapRow));
}

export async function createAddress(
  rawInput: unknown,
): Promise<ActionResult<BuyerAddress>> {
  const parsed = CreateAddressInput.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid address", parsed.error.flatten().fieldErrors);
  }
  const g = await guard();
  if ("ok" in g) return g;
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();

  const { count } = await supabase
    .from("buyer_addresses")
    .select("id", { count: "exact", head: true });
  const makeDefault = input.makeDefault || !count;

  if (makeDefault && count) {
    await supabase.from("buyer_addresses").update({ is_default: false }).eq("is_default", true);
  }

  const { data, error } = await supabase
    .from("buyer_addresses")
    .insert({
      buyer_id: g.buyerId,
      address_line: input.addressLine,
      postcode: input.postcode,
      state: input.state,
      area: input.area,
      is_default: makeDefault,
    })
    .select("*")
    .single();

  if (error || !data) return err("internal", "Failed to save address");
  return ok(mapRow(data as AddressRow));
}

export async function setDefaultAddress(
  addressId: string,
): Promise<ActionResult<BuyerAddress>> {
  if (!AddressId.safeParse(addressId).success) {
    return err("validation", "Invalid address id");
  }
  const g = await guard();
  if ("ok" in g) return g;

  const supabase = await createSupabaseServerClient();
  await supabase.from("buyer_addresses").update({ is_default: false }).eq("is_default", true);
  const { data, error } = await supabase
    .from("buyer_addresses")
    .update({ is_default: true })
    .eq("id", addressId)
    .select("*")
    .single();

  if (error || !data) return err("not_found", "Address not found");
  return ok(mapRow(data as AddressRow));
}

export async function deleteAddress(
  addressId: string,
): Promise<ActionResult<{ deletedId: string }>> {
  if (!AddressId.safeParse(addressId).success) {
    return err("validation", "Invalid address id");
  }
  const g = await guard();
  if ("ok" in g) return g;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("buyer_addresses")
    .delete()
    .eq("id", addressId)
    .select("id, is_default");

  if (error) return err("internal", "Failed to delete address");
  const deleted = (data ?? [])[0] as { id: string; is_default: boolean } | undefined;
  if (!deleted) return err("not_found", "Address not found");

  if (deleted.is_default) {
    // Promote the oldest remaining address, if any.
    const { data: oldest } = await supabase
      .from("buyer_addresses")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (oldest) {
      await supabase.from("buyer_addresses").update({ is_default: true }).eq("id", oldest.id);
    }
  }

  return ok({ deletedId: deleted.id });
}
```

Note the guard-return discriminator: `guard()` returns either `{ buyerId }` or an `ActionResult` error — `"ok" in g` distinguishes them (the error object has an `ok` property, the success object does not).

- [ ] **Step 5: Run tests until green**

Run: `npx vitest run src/features/buyer/tests/unit/address-actions.test.ts`
Expected: PASS (adjust stub wiring, not the action contract).

- [ ] **Step 6: Verify + commit**

Run: `npm run typecheck && npm run test`
Expected: PASS.

```bash
git add src/features/buyer/server/address-actions.ts src/features/buyer/tests/unit/address-actions.test.ts src/features/buyer/types.ts
git commit -m "feat(buyer): address book server actions (list/create/default/delete)"
```

---

### Task 6: Checkout rework — address book UI + silent zone resolution

**Files:**
- Create: `src/features/buyer/components/address-fields.tsx`
- Modify: `src/app/buyer_portal/[organizationSlug]/checkout/checkout-client.tsx`
- Modify: `src/features/orders/server/portal-actions.ts` (add `resolveZoneForPostcode`)
- Create: `src/features/orders/tests/unit/portal-resolve-zone.test.ts`

**Interfaces:**
- Consumes: Task 1 RPC, Task 4 helpers, Task 5 actions, existing `getDeliveryOptions(organizationSlug, zoneId)` and `placeOrder(input)` (unchanged signatures).
- Produces: `resolveZoneForPostcode(organizationSlug: string, postcode: string): Promise<ActionResult<{ zoneId: string | null }>>` in portal-actions. `AddressFields` component (controlled): props `{ value: { addressLine: string; postcode: string; state: string; area: string }; onChange(next): void; disabled?: boolean }`.

- [ ] **Step 1: Add `resolveZoneForPostcode` to portal-actions**

Append to `src/features/orders/server/portal-actions.ts`:

```ts
export async function resolveZoneForPostcode(
  organizationSlug: string,
  postcode: string,
): Promise<ActionResult<{ zoneId: string | null }>> {
  try {
    await requireBuyer();
  } catch (e) {
    if (e instanceof NotABuyerError) {
      return err("unauthenticated", e.message);
    }
    throw e;
  }

  if (!/^[0-9]{5}$/.test(postcode)) {
    return err("validation", "Enter a 5-digit postcode");
  }

  const supabase = await createSupabaseServerClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", organizationSlug)
    .single();
  if (!org) {
    return err("not_found", "Organization not found");
  }

  const { data, error } = await supabase.rpc("resolve_zone_for_postcode", {
    p_org: org.id,
    p_postcode: postcode,
  });

  if (error) {
    return err("internal", "Failed to check delivery coverage");
  }

  return ok({ zoneId: (data as string | null) ?? null });
}
```

- [ ] **Step 2: Write failing unit test** (`src/features/orders/tests/unit/portal-resolve-zone.test.ts`) — same mock idiom as `schedule-actions.test.ts`, but wire `from("buyers")` for `requireBuyer` and `rpc` on the client stub:

```ts
it("returns validation error without touching the DB for a malformed postcode", ...);
it("returns zoneId null when the RPC finds no covering zone", ...);
it("returns the zone id when the RPC resolves one", ...);
it("returns unauthenticated when signed out", ...);
```

Full test bodies follow the Task 5 test structure (arrange stub → call → assert `result.ok` / `code` / `data.zoneId`).

Run: `npx vitest run src/features/orders/tests/unit/portal-resolve-zone.test.ts` → FAIL first, then implement/wire until PASS.

- [ ] **Step 3: Build `AddressFields`** (`src/features/buyer/components/address-fields.tsx`)

```tsx
"use client";

/**
 * Structured Malaysian address form: address line, postcode, state, area.
 * Typing a known 5-digit postcode auto-fills state and area (suggestion
 * only — both stay editable). Area options are shortlisted by the chosen
 * state via the vendored postcode dataset.
 */

import {
  areasForState,
  lookupPostcode,
  statesList,
} from "@/features/buyer/lib/malaysia-postcodes";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type AddressValue = {
  addressLine: string;
  postcode: string;
  state: string;
  area: string;
};

type AddressFieldsProps = {
  value: AddressValue;
  onChange: (next: AddressValue) => void;
  disabled?: boolean;
};

export function AddressFields({ value, onChange, disabled }: AddressFieldsProps) {
  const areas = value.state ? areasForState(value.state) : [];

  const handlePostcode = (raw: string) => {
    const postcode = raw.replace(/\D/g, "").slice(0, 5);
    const hit = postcode.length === 5 ? lookupPostcode(postcode) : null;
    onChange(
      hit
        ? { ...value, postcode, state: hit.state, area: hit.area }
        : { ...value, postcode },
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="address-line">Address</Label>
        <Textarea
          id="address-line"
          placeholder="House no, street, taman/apartment"
          value={value.addressLine}
          onChange={(e) => onChange({ ...value, addressLine: e.target.value })}
          rows={3}
          disabled={disabled}
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="address-postcode">Postcode</Label>
          <Input
            id="address-postcode"
            placeholder="e.g. 80000"
            value={value.postcode}
            onChange={(e) => handlePostcode(e.target.value)}
            inputMode="numeric"
            maxLength={5}
            disabled={disabled}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="address-state">State</Label>
          <Select
            value={value.state}
            onValueChange={(state) =>
              onChange({ ...value, state, area: "" })
            }
            disabled={disabled}
          >
            <SelectTrigger id="address-state" className="w-full">
              <SelectValue placeholder="Select state" />
            </SelectTrigger>
            <SelectContent>
              {statesList().map((state) => (
                <SelectItem key={state} value={state}>
                  {state}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="address-area">Area</Label>
        <Select
          value={value.area}
          onValueChange={(area) => onChange({ ...value, area })}
          disabled={disabled || !value.state}
        >
          <SelectTrigger id="address-area" className="w-full">
            <SelectValue
              placeholder={value.state ? "Select area" : "Pick a state first"}
            />
          </SelectTrigger>
          <SelectContent>
            {areas.map((area) => (
              <SelectItem key={area} value={area}>
                {area}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
```

Edge case: an auto-filled `area` value from `lookupPostcode` always exists in `areasForState(state)` (same dataset), so the Select shows it. A hand-picked state resets area to force a valid pick.

- [ ] **Step 4: Rework `checkout-client.tsx`**

Changes, keeping the existing delivery-slot UI, order summary, submit flow, and toasts:

1. Remove the zone `Select` block, `zones`, `zonesLoading` state, and the `getActiveZones` import/effect.
2. New state:

```ts
  const [savedAddresses, setSavedAddresses] = useState<BuyerAddress[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(true);
  const [selectedAddressId, setSelectedAddressId] = useState<string>("new");
  const [newAddress, setNewAddress] = useState<AddressValue>({
    addressLine: "",
    postcode: "",
    state: "",
    area: "",
  });
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [zoneState, setZoneState] = useState<"idle" | "resolving" | "resolved" | "uncovered">("idle");
```

3. Load addresses on mount; preselect the default (or first, else `"new"`):

```ts
  useEffect(() => {
    let cancelled = false;
    listMyAddresses().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setSavedAddresses(result.data);
        const preferred = result.data.find((a) => a.isDefault) ?? result.data[0];
        if (preferred) setSelectedAddressId(preferred.id);
      }
      setAddressesLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);
```

4. Effective address:

```ts
  const activeAddress: AddressValue | null = useMemo(() => {
    if (selectedAddressId !== "new") {
      const saved = savedAddresses.find((a) => a.id === selectedAddressId);
      return saved
        ? {
            addressLine: saved.addressLine,
            postcode: saved.postcode,
            state: saved.state,
            area: saved.area,
          }
        : null;
    }
    return newAddress;
  }, [selectedAddressId, savedAddresses, newAddress]);
```

5. Zone resolution effect — replaces the old zone-select → options chain. Debounce not needed (postcode is exactly 5 chars or not):

```ts
  useEffect(() => {
    const postcode = activeAddress?.postcode ?? "";
    if (!/^[0-9]{5}$/.test(postcode)) {
      setZoneId(null);
      setZoneState("idle");
      return;
    }
    let cancelled = false;
    setZoneState("resolving");
    resolveZoneForPostcode(organizationSlug, postcode).then((result) => {
      if (cancelled) return;
      if (result.ok && result.data.zoneId) {
        setZoneId(result.data.zoneId);
        setZoneState("resolved");
      } else {
        setZoneId(null);
        setZoneState("uncovered");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [organizationSlug, activeAddress?.postcode]);
```

The existing delivery-options effect keeps its shape but keys off the resolved `zoneId` (type now `string | null` — guard `if (!organizationSlug || !zoneId)`).

6. Address card UI (replaces old zone select + address textarea + postcode input; order-notes textarea stays):
   - While `addressesLoading`: small `Loader2` row.
   - If `savedAddresses.length > 0`: radio-style buttons (same visual idiom as the delivery-slot buttons: `role="radio"`, `aria-checked`, border-primary when selected) — one per saved address showing `addressLine`, `area, postcode state`, a "Default" badge when `isDefault` — plus a final "+ New address" option that sets `selectedAddressId("new")`.
   - When `selectedAddressId === "new"` (always the case for a buyer with no saved addresses): render `<AddressFields value={newAddress} onChange={setNewAddress} disabled={submitting} />`.
   - Below the card, coverage feedback: `zoneState === "uncovered"` → destructive-toned text "No delivery to your area yet."; `"resolving"` → muted "Checking delivery coverage…".

7. Submit gating:

```ts
  const canSubmit =
    items.length > 0 &&
    activeAddress !== null &&
    activeAddress.addressLine.trim().length > 0 &&
    /^[0-9]{5}$/.test(activeAddress.postcode) &&
    activeAddress.state !== "" &&
    activeAddress.area !== "" &&
    zoneState === "resolved" &&
    zoneId !== null &&
    selectedOption !== null &&
    !submitting;
```

8. `handleSubmit` — compose the stored address and auto-save a new one:

```ts
    const composedAddress = `${activeAddress.addressLine.trim()}, ${activeAddress.postcode} ${activeAddress.area}, ${activeAddress.state}`;
    const result = await placeOrder({
      organizationSlug,
      zoneId,
      slotId: selectedOption.slotId,
      deliveryDate: selectedOption.date,
      address: composedAddress,
      postcode: activeAddress.postcode,
      notes: notes.trim() || undefined,
      items: /* unchanged mapping */,
    });
```

After a successful order, when `selectedAddressId === "new"`: fire `createAddress({ addressLine: newAddress.addressLine.trim(), postcode: newAddress.postcode, state: newAddress.state, area: newAddress.area })` and ignore its failure (order already placed — an address-save failure must not break the success screen).

9. Imports to add: `listMyAddresses`, `createAddress` from `@/features/buyer/server/address-actions`; `resolveZoneForPostcode` from `@/features/orders/server/portal-actions`; `AddressFields`, `AddressValue` from `@/features/buyer/components/address-fields`; `BuyerAddress` from `@/features/buyer/types`. Remove now-unused `getActiveZones` import and `DeliveryZone` type import.

- [ ] **Step 5: Browser-verify the full flow**

`npm run dev`; seed zone + postcode range on the delivery page as OWNER (e2e fixture creds) if none exist; then as BUYER: checkout → new address, type covered postcode → state/area auto-fill, slots appear without any zone dropdown → place order → revisit checkout → saved address preselected, zone resolves silently. Also verify an uncovered postcode (e.g. `99000` if unmapped) shows "No delivery to your area yet." and submit stays disabled.

- [ ] **Step 6: Verify + commit**

Run: `npm run typecheck && npm run test`
Expected: PASS.

```bash
git add "src/app/buyer_portal/[organizationSlug]/checkout/checkout-client.tsx" src/features/buyer/components/address-fields.tsx src/features/orders/server/portal-actions.ts src/features/orders/tests/unit/portal-resolve-zone.test.ts
git commit -m "feat(buyer): address book checkout with silent postcode-to-zone resolution"
```

---

### Task 7: E2E — signup with phone, first checkout saves address, second reuses it

**Files:**
- Create: `e2e/buyer-address.spec.ts`
- Read for patterns (do not modify): `e2e/buyer-order.spec.ts`, `e2e/_fixtures.ts`

**Interfaces:**
- Consumes: everything shipped in Tasks 1–6; e2e fixtures `OWNER`, `signIn`, `uniqueFixtureName` from `e2e/_fixtures.ts` (fixtures file has unrelated local modifications — import what exists, do not edit it).

- [ ] **Step 1: Write the spec** (`e2e/buyer-address.spec.ts`)

One `test()` (suite runs `workers: 1` against a persisted DB — mirror `buyer-order.spec.ts` structure):

1. As OWNER: create a sellable product (copy the `createSellableProduct` helper from `buyer-order.spec.ts` verbatim into this spec). On `/ayam-norliza-pilot/delivery`, ensure a zone exists with postcode range `50000`–`59999` (create zone `uniqueFixtureName("E2E Addr Zone")` + range via the delivery page UI; a truck+slot covering the zone is also required for slots to appear — follow the same seeding the existing `buyer-order.spec.ts`/`order-pipeline.spec.ts` flow uses for slots).
2. New page: signup as a fresh buyer — `/buyer_portal/ayam-norliza-pilot/login`, switch to Sign up, fill name / unique email / phone `012-345 6789` / password twice, submit; expect landing on shop.
3. Add product to cart, go to checkout (already signed in — no redirect).
4. Fill new address: address line `12 Jalan E2E`, postcode `50000` → expect State select to show `Kuala Lumpur` (dataset spelling) and Area auto-filled, with NO zone dropdown present on the page (`expect(page.getByLabel("Delivery Zone")).toHaveCount(0)`).
5. Pick a slot, place order, expect the success card.
6. Return to `/buyer_portal/ayam-norliza-pilot/checkout` with a new cart item: expect a saved-address radio showing `12 Jalan E2E` preselected and slots loading without any manual zone/postcode entry.
7. Signed-out gate: in a fresh context page, visit checkout directly → expect URL to contain `/login?next=`.

- [ ] **Step 2: Run it**

Run: `npx playwright test e2e/buyer-address.spec.ts`
Expected: PASS. (Prereq: local supabase reset + dev server per the repo's existing e2e workflow — copy whatever `playwright.config.ts` `webServer` already does; do not invent new setup.)

- [ ] **Step 3: Full suite sanity**

Run: `npm run test && npm run typecheck && npx playwright test e2e/buyer-order.spec.ts e2e/buyer-address.spec.ts`
Expected: all PASS — `buyer-order.spec.ts` exercises the reworked checkout and is the regression canary. If it fails on the removed zone dropdown, update THAT spec's checkout steps (zone select no longer exists; it must fill the structured address instead) — that is an expected, in-scope edit; note it in the commit.

- [ ] **Step 4: Commit**

```bash
git add e2e/buyer-address.spec.ts
# plus e2e/buyer-order.spec.ts ONLY if Step 3 required updating its checkout steps
git commit -m "test(e2e): buyer signup with phone, address book checkout, zone auto-resolve"
```
