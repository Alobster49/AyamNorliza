# Dispatch Logistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Physical loading bays containing trucks, postcode-driven zone matching, auto-assignment of confirmed orders to trucks (manual drag always wins), and a drag-and-drop dispatch board with truck departure animation.

**Architecture:** New feature module `src/features/logistics/` (pure libs + server actions + thin React components), one SQL migration extending the existing order-pipeline schema (`facilities`, `bays`, `trucks.bay_id`, `zone_postcode_ranges`, `orders.postcode`/`assignment_source`, two dispatch RPCs). The board reuses the dnd-kit pattern from `orders-board.tsx`: drops resolve through a pure state machine, server writes go through SECURITY DEFINER RPCs.

**Tech Stack:** Next.js 16 App Router, React 18, Supabase (Postgres + RLS + RPC), Zod, dnd-kit, Tailwind 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-13-dispatch-logistics-design.md`

## Global Constraints

- All server action inputs arrive as `unknown` and go through Zod `safeParse` (repo convention).
- Server actions return `ActionResult<T>` (`{ ok: true, data } | { ok: false, code, message, fieldErrors? }`) — import from `@/features/orders/types`.
- Role names are exactly: `owner`, `org_admin`, `seller`, `logistics` (see `src/features/orders/lib/roles.ts`).
- RLS policies copy the style of `supabase/migrations/20260810000001_order_pipeline_schema.sql` (subselect on `organization_members` with `status = 'active'` and expiry check).
- RPCs are `security definer`, `set search_path = public, pg_temp`, revoke from public / grant to authenticated, and signal errors with `raise exception using errcode = 'P0001', message = '<code>'`.
- Postcodes are Malaysian: exactly 5 digits, stored as `text`.
- Test runner: `npx vitest run <file>`. Full suite: `npm run test`. Migration check: `npm run db:reset`.
- Auto-assignment must NEVER overwrite `assignment_source = 'manual'`. Enforced in both the pure lib and the RPC.
- Weekday convention: 0=Sunday (JS `Date.getDay()`), matching `delivery_slots.weekday`.
- Commit after every task with a conventional-commit message ending in the Claude co-author trailer.

---

### Task 1: Database migration — logistics schema + dispatch RPCs

**Files:**
- Create: `supabase/migrations/20260814000001_logistics_dispatch_schema.sql`

**Interfaces:**
- Produces tables: `facilities`, `bays`, `zone_postcode_ranges`; columns `trucks.bay_id`, `orders.postcode`, `orders.assignment_source`; enum `assignment_source`; RPCs `dispatch_assign_order(p_order uuid, p_truck uuid, p_source assignment_source)`, `dispatch_unassign_order(p_order uuid)`; `set_run_status` re-created to also allow the `logistics` role.

- [ ] **Step 1: Write the migration**

```sql
-- 20260814000001_logistics_dispatch_schema.sql
-- Dispatch logistics: factory facility + loading bays, postcode ranges per
-- delivery zone, order assignment tracking, and dispatch RPCs. See
-- docs/superpowers/specs/2026-08-13-dispatch-logistics-design.md.

begin;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.assignment_source as enum ('none','auto','manual');

-- ---------------------------------------------------------------------------
-- facilities
-- ---------------------------------------------------------------------------
create table if not exists public.facilities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  address_line text not null check (char_length(address_line) between 1 and 500),
  postcode text not null check (postcode ~ '^[0-9]{5}$'),
  state text not null check (char_length(state) between 1 and 100),
  is_active boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create index if not exists facilities_org_idx on public.facilities(organization_id);

comment on table public.facilities is 'Physical factory/warehouse locations. Single row per org today; multi-facility later is an insert.';

drop trigger if exists facilities_updated_at on public.facilities;
create trigger facilities_updated_at before update on public.facilities
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- bays
-- ---------------------------------------------------------------------------
create table if not exists public.bays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  position integer not null default 0,
  is_active boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create index if not exists bays_org_idx on public.bays(organization_id);
create index if not exists bays_facility_idx on public.bays(facility_id);

comment on table public.bays is 'Physical loading docks at a facility. Trucks park in a bay to load.';

drop trigger if exists bays_updated_at on public.bays;
create trigger bays_updated_at before update on public.bays
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- trucks.bay_id
-- ---------------------------------------------------------------------------
alter table public.trucks add column if not exists bay_id uuid null references public.bays(id) on delete set null;
create index if not exists trucks_bay_idx on public.trucks(bay_id);

-- ---------------------------------------------------------------------------
-- zone_postcode_ranges
-- ---------------------------------------------------------------------------
create table if not exists public.zone_postcode_ranges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  zone_id uuid not null references public.delivery_zones(id) on delete cascade,
  postcode_start text not null check (postcode_start ~ '^[0-9]{5}$'),
  postcode_end text not null check (postcode_end ~ '^[0-9]{5}$'),
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (postcode_end >= postcode_start)
);

create index if not exists zone_postcode_ranges_org_idx on public.zone_postcode_ranges(organization_id);
create index if not exists zone_postcode_ranges_zone_idx on public.zone_postcode_ranges(zone_id);

comment on table public.zone_postcode_ranges is 'Inclusive postcode ranges per delivery zone. Cross-zone overlap allowed; first match by zone name wins.';

-- ---------------------------------------------------------------------------
-- orders.postcode + orders.assignment_source
-- ---------------------------------------------------------------------------
alter table public.orders add column if not exists postcode text null check (postcode is null or postcode ~ '^[0-9]{5}$');
alter table public.orders add column if not exists assignment_source public.assignment_source not null default 'none';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.facilities enable row level security;
alter table public.bays enable row level security;
alter table public.zone_postcode_ranges enable row level security;

-- facilities: org members read; ONLY owner/org_admin write (stricter than managers).
create policy "facilities_select" on public.facilities
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
    )
  );

create policy "facilities_insert" on public.facilities
  for insert to authenticated with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin')
    )
  );

create policy "facilities_update" on public.facilities
  for update to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin')
    )
  );

create policy "facilities_delete" on public.facilities
  for delete to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin')
    )
  );

-- bays: org members read; managers write.
create policy "bays_select" on public.bays
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
    )
  );

create policy "bays_insert" on public.bays
  for insert to authenticated with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "bays_update" on public.bays
  for update to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "bays_delete" on public.bays
  for delete to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin', 'seller')
    )
  );

-- zone_postcode_ranges: org members read; managers insert/delete (no update — replace rows).
create policy "zone_postcode_ranges_select" on public.zone_postcode_ranges
  for select to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
    )
  );

create policy "zone_postcode_ranges_insert" on public.zone_postcode_ranges
  for insert to authenticated with check (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin', 'seller')
    )
  );

create policy "zone_postcode_ranges_delete" on public.zone_postcode_ranges
  for delete to authenticated using (
    organization_id in (
      select organization_id from public.organization_members
      where user_id = auth.uid() and status = 'active' and (expires_at is null or expires_at > now())
      and role in ('owner', 'org_admin', 'seller')
    )
  );

-- ---------------------------------------------------------------------------
-- dispatch_assign_order: assign a confirmed/ready order to a truck.
-- Upserts the truck+date delivery_runs row (mirrors confirm_order) and
-- moves the order onto it. p_source='auto' never overwrites a manual
-- assignment. Allowed roles include logistics staff.
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_assign_order(p_order uuid, p_truck uuid, p_source public.assignment_source)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_status public.order_status;
  v_date date;
  v_old_run uuid;
  v_old_run_status public.delivery_run_status;
  v_source public.assignment_source;
  v_run uuid;
begin
  if p_source not in ('auto', 'manual') then
    raise exception using errcode = 'P0001', message = 'invalid_source';
  end if;

  select organization_id, status, delivery_date, run_id, assignment_source
  into v_org, v_status, v_date, v_old_run, v_source
  from public.orders where id = p_order;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.has_org_role(v_org, array['owner', 'org_admin', 'seller', 'logistics']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_status not in ('confirmed', 'ready') then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  if v_old_run is not null then
    select status into v_old_run_status from public.delivery_runs where id = v_old_run;
    if v_old_run_status = 'departed' then
      raise exception using errcode = 'P0001', message = 'run_departed';
    end if;
  end if;

  -- Auto never overrides manual.
  if p_source = 'auto' and v_source = 'manual' then
    return;
  end if;

  if not exists (
    select 1 from public.trucks
    where id = p_truck and organization_id = v_org and is_active = true
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_truck';
  end if;

  select id into v_run from public.delivery_runs where truck_id = p_truck and run_date = v_date;
  if v_run is null then
    insert into public.delivery_runs (organization_id, truck_id, run_date)
    values (v_org, p_truck, v_date)
    returning id into v_run;
  end if;

  if (select status from public.delivery_runs where id = v_run) = 'departed' then
    raise exception using errcode = 'P0001', message = 'run_departed';
  end if;

  update public.orders
  set truck_id = p_truck, run_id = v_run, assignment_source = p_source
  where id = p_order;
end;
$$;

revoke all on function public.dispatch_assign_order(uuid, uuid, public.assignment_source) from public;
grant execute on function public.dispatch_assign_order(uuid, uuid, public.assignment_source) to authenticated;

-- ---------------------------------------------------------------------------
-- dispatch_unassign_order: send a ticket back to the pool. truck_id stays
-- (column is NOT NULL — it keeps the checkout choice as a default); the
-- board treats assignment_source='none' as "in pool".
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_unassign_order(p_order uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_status public.order_status;
  v_run uuid;
  v_run_status public.delivery_run_status;
begin
  select organization_id, status, run_id into v_org, v_status, v_run
  from public.orders where id = p_order;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if not public.has_org_role(v_org, array['owner', 'org_admin', 'seller', 'logistics']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if v_status not in ('confirmed', 'ready') then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;

  if v_run is not null then
    select status into v_run_status from public.delivery_runs where id = v_run;
    if v_run_status = 'departed' then
      raise exception using errcode = 'P0001', message = 'run_departed';
    end if;
  end if;

  update public.orders set assignment_source = 'none' where id = p_order;
end;
$$;

revoke all on function public.dispatch_unassign_order(uuid) from public;
grant execute on function public.dispatch_unassign_order(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- set_run_status: re-create with 'logistics' added to the allowed roles so
-- logistics staff can depart trucks from the dispatch board. Body otherwise
-- identical to 20260810000002.
-- ---------------------------------------------------------------------------
create or replace function public.set_run_status(p_run uuid, p_status public.delivery_run_status)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_current public.delivery_run_status;
begin
  select organization_id, status into v_org, v_current from public.delivery_runs where id = p_run;

  if v_org is null then
    raise exception using errcode = 'P0001', message = 'invalid_transition';
  end if;

  if not public.has_org_role(v_org, array['owner', 'org_admin', 'seller', 'logistics']) then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;

  if not (
    (v_current = 'planned' and p_status = 'departed')
    or (v_current = 'departed' and p_status = 'completed')
    or (v_current = 'planned' and p_status = 'completed')
    -- Idempotent re-fire: confirm_order can still attach a newly-confirmed
    -- order to an already-completed run's delivery_runs row (it upserts on
    -- (truck_id, run_date) with no run-status check), and that order can
    -- later reach 'ready' via complete_order_task. Without this case those
    -- orders are permanently stuck at 'ready' -- completed -> completed
    -- is allowed specifically so the ready -> delivered sweep below can
    -- run again and pick them up.
    or (v_current = 'completed' and p_status = 'completed')
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_transition';
  end if;

  update public.delivery_runs set status = p_status where id = p_run;

  if p_status = 'completed' then
    update public.orders set status = 'delivered' where run_id = p_run and status = 'ready';
  end if;
end;
$$;

revoke all on function public.set_run_status(uuid, public.delivery_run_status) from public;
grant execute on function public.set_run_status(uuid, public.delivery_run_status) to authenticated;

-- ---------------------------------------------------------------------------
-- Default facility row for every existing org (dev convenience; owner can
-- edit in the Factory tab).
-- ---------------------------------------------------------------------------
insert into public.facilities (organization_id, name, address_line, postcode, state)
select id, 'Kilang Ayam', 'Ptd 7904, Batu 31, Kg. Parit Baru, Pontian', '82000', 'Johor'
from public.organizations;

commit;
```

- [ ] **Step 2: Apply and verify**

Run: `npm run db:reset`
Expected: completes without error, applies `20260814000001_logistics_dispatch_schema.sql` last.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260814000001_logistics_dispatch_schema.sql
git commit -m "feat(logistics): facilities, bays, postcode ranges, dispatch RPCs"
```

---

### Task 2: Logistics types, roles, and Zod schemas

**Files:**
- Create: `src/features/logistics/types.ts`
- Create: `src/features/logistics/lib/roles.ts`
- Modify: `src/features/orders/types.ts` (Order row type gains 2 fields)
- Test: `src/features/logistics/tests/unit/types.test.ts`

**Interfaces:**
- Produces types: `Facility`, `Bay`, `ZonePostcodeRange`, `AssignmentSource`, `DispatchTruck`, `DispatchTicket`, `DispatchBoardData`
- Produces schemas: `FacilityInputSchema`, `BayInputSchema`, `PostcodeRangeInputSchema`
- Produces roles: `FACILITY_ADMIN_ROLES` (owner, org_admin), `DISPATCH_ROLES` (owner, org_admin, seller, logistics)

- [ ] **Step 1: Write the failing test**

`src/features/logistics/tests/unit/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  FacilityInputSchema,
  BayInputSchema,
  PostcodeRangeInputSchema,
} from "../../types";

describe("FacilityInputSchema", () => {
  it("accepts a valid facility", () => {
    const result = FacilityInputSchema.safeParse({
      name: "Kilang Ayam",
      addressLine: "Ptd 7904, Batu 31, Kg. Parit Baru, Pontian",
      postcode: "82000",
      state: "Johor",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-5-digit postcode", () => {
    const result = FacilityInputSchema.safeParse({
      name: "Kilang Ayam",
      addressLine: "x",
      postcode: "8200",
      state: "Johor",
    });
    expect(result.success).toBe(false);
  });
});

describe("BayInputSchema", () => {
  it("defaults position and isActive", () => {
    const result = BayInputSchema.safeParse({
      facilityId: "5b1f5c1e-0000-4000-8000-000000000001",
      name: "Bay 1",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.position).toBe(0);
      expect(result.data.isActive).toBe(true);
    }
  });
});

describe("PostcodeRangeInputSchema", () => {
  it("rejects end < start", () => {
    const result = PostcodeRangeInputSchema.safeParse({
      zoneId: "5b1f5c1e-0000-4000-8000-000000000001",
      postcodeStart: "82300",
      postcodeEnd: "82000",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a single-postcode range", () => {
    const result = PostcodeRangeInputSchema.safeParse({
      zoneId: "5b1f5c1e-0000-4000-8000-000000000001",
      postcodeStart: "82000",
      postcodeEnd: "82000",
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/logistics/tests/unit/types.test.ts`
Expected: FAIL — cannot resolve `../../types`.

- [ ] **Step 3: Write `src/features/logistics/types.ts`**

```ts
/**
 * Logistics feature types and schemas: facility/bay config, postcode
 * coverage ranges, and the dispatch board composites. Row types mirror the
 * DB in snake_case (same convention as @/features/orders/types).
 */

import { z } from "zod";
import type {
  DeliveryRun,
  DeliverySlot,
  DeliveryZone,
  Order,
  ScheduleBlock,
  Truck,
  TruckZone,
} from "@/features/orders/types";

export const POSTCODE_REGEX = /^\d{5}$/;

export type AssignmentSource = "none" | "auto" | "manual";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export type Facility = {
  id: string;
  organization_id: string;
  name: string;
  address_line: string;
  postcode: string;
  state: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export type Bay = {
  id: string;
  organization_id: string;
  facility_id: string;
  name: string;
  position: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export type ZonePostcodeRange = {
  id: string;
  organization_id: string;
  zone_id: string;
  postcode_start: string;
  postcode_end: string;
  created_by: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Composites
// ---------------------------------------------------------------------------

export type DispatchTruck = Truck & { bay_id: string | null };

export type DispatchTicket = Order & {
  customer?: { name: string };
  zone?: { name: string };
  item_count?: number;
};

export type DispatchBoardData = {
  facility: Facility | null;
  bays: Bay[];
  trucks: DispatchTruck[];
  zones: DeliveryZone[];
  ranges: ZonePostcodeRange[];
  truckZones: TruckZone[];
  slots: DeliverySlot[];
  blocks: ScheduleBlock[];
  runs: DeliveryRun[];
  orders: DispatchTicket[];
};

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const FacilityInputSchema = z.object({
  name: z.string().min(1).max(100),
  addressLine: z.string().min(1).max(500),
  postcode: z.string().regex(POSTCODE_REGEX, "Postcode must be 5 digits"),
  state: z.string().min(1).max(100),
});
export type FacilityInput = z.infer<typeof FacilityInputSchema>;

export const BayInputSchema = z.object({
  facilityId: z.string().uuid(),
  name: z.string().min(1).max(100),
  position: z.number().int().default(0),
  isActive: z.boolean().default(true),
});
export type BayInput = z.infer<typeof BayInputSchema>;

export const PostcodeRangeInputSchema = z
  .object({
    zoneId: z.string().uuid(),
    postcodeStart: z.string().regex(POSTCODE_REGEX, "Postcode must be 5 digits"),
    postcodeEnd: z.string().regex(POSTCODE_REGEX, "Postcode must be 5 digits"),
  })
  .refine((v) => v.postcodeEnd >= v.postcodeStart, {
    message: "End postcode must be greater than or equal to start postcode",
    path: ["postcodeEnd"],
  });
export type PostcodeRangeInput = z.infer<typeof PostcodeRangeInputSchema>;
```

- [ ] **Step 4: Write `src/features/logistics/lib/roles.ts`**

```ts
/**
 * Client-safe role lists for the logistics feature. Mirror the role arrays
 * the SQL RPCs enforce with `has_org_role` (see the 20260814000001
 * migration): dispatch actions allow logistics staff; facility edits are
 * owner/org_admin only.
 */

export const FACILITY_ADMIN_ROLES = ["owner", "org_admin"] as const;
export const DISPATCH_ROLES = ["owner", "org_admin", "seller", "logistics"] as const;
```

- [ ] **Step 5: Extend the Order row type**

In `src/features/orders/types.ts`, add two fields to `Order` after `run_id: string | null;`:

```ts
  postcode: string | null;
  assignment_source: "none" | "auto" | "manual";
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/features/logistics/tests/unit/types.test.ts`
Expected: PASS (5 tests).

Run: `npm run typecheck`
Expected: PASS (adding required fields to `Order` may surface literals in tests that construct `Order` objects — add `postcode: null, assignment_source: "none"` to any fixture the compiler flags).

- [ ] **Step 7: Commit**

```bash
git add src/features/logistics src/features/orders/types.ts
git commit -m "feat(logistics): types, roles, and input schemas"
```

---

### Task 3: Postcode matching lib

**Files:**
- Create: `src/features/logistics/lib/postcode.ts`
- Test: `src/features/logistics/tests/unit/postcode.test.ts`

**Interfaces:**
- Consumes: `POSTCODE_REGEX`, `ZonePostcodeRange` from `../types`; `DeliveryZone` from `@/features/orders/types`
- Produces: `isValidPostcode(value: string): boolean`, `matchZone(postcode: string, ranges: ZonePostcodeRange[], zones: DeliveryZone[]): string | null` (returns zone id; ties broken by zone name ascending, then zone id)

- [ ] **Step 1: Write the failing test**

`src/features/logistics/tests/unit/postcode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isValidPostcode, matchZone } from "../../lib/postcode";
import type { ZonePostcodeRange } from "../../types";
import type { DeliveryZone } from "@/features/orders/types";

function zone(id: string, name: string): DeliveryZone {
  return {
    id,
    organization_id: "org-1",
    name,
    display_order: 0,
    is_active: true,
    created_by: null,
    created_at: "",
    updated_at: "",
    version: 1,
  };
}

function range(zoneId: string, start: string, end: string): ZonePostcodeRange {
  return {
    id: `${zoneId}-${start}`,
    organization_id: "org-1",
    zone_id: zoneId,
    postcode_start: start,
    postcode_end: end,
    created_by: null,
    created_at: "",
  };
}

describe("isValidPostcode", () => {
  it("accepts 5 digits", () => {
    expect(isValidPostcode("82000")).toBe(true);
  });
  it("rejects short, long, and non-numeric values", () => {
    expect(isValidPostcode("8200")).toBe(false);
    expect(isValidPostcode("820000")).toBe(false);
    expect(isValidPostcode("82OOO")).toBe(false);
    expect(isValidPostcode("")).toBe(false);
  });
});

describe("matchZone", () => {
  const zones = [zone("z-south", "South"), zone("z-north", "North")];

  it("matches a postcode inside a range", () => {
    const ranges = [range("z-south", "82000", "82300")];
    expect(matchZone("82100", ranges, zones)).toBe("z-south");
  });

  it("matches range boundaries inclusively", () => {
    const ranges = [range("z-south", "82000", "82300")];
    expect(matchZone("82000", ranges, zones)).toBe("z-south");
    expect(matchZone("82300", ranges, zones)).toBe("z-south");
  });

  it("returns null when no range contains the postcode", () => {
    const ranges = [range("z-south", "82000", "82300")];
    expect(matchZone("81900", ranges, zones)).toBe(null);
  });

  it("breaks overlap ties by zone name ascending", () => {
    const ranges = [
      range("z-south", "82000", "82300"),
      range("z-north", "82000", "82300"),
    ];
    // "North" < "South" alphabetically.
    expect(matchZone("82100", ranges, zones)).toBe("z-north");
  });

  it("returns null for an invalid postcode", () => {
    const ranges = [range("z-south", "82000", "82300")];
    expect(matchZone("bad", ranges, zones)).toBe(null);
  });

  it("ignores ranges whose zone is missing from the zone list", () => {
    const ranges = [range("z-ghost", "82000", "82300")];
    expect(matchZone("82100", ranges, zones)).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/logistics/tests/unit/postcode.test.ts`
Expected: FAIL — cannot resolve `../../lib/postcode`.

- [ ] **Step 3: Write `src/features/logistics/lib/postcode.ts`**

```ts
/**
 * Pure postcode helpers. Malaysian postcodes are exactly 5 digits, so
 * lexicographic comparison on the fixed-length strings equals numeric
 * comparison — no parseInt needed.
 */

import type { DeliveryZone } from "@/features/orders/types";
import { POSTCODE_REGEX, type ZonePostcodeRange } from "../types";

export function isValidPostcode(value: string): boolean {
  return POSTCODE_REGEX.test(value);
}

/**
 * Resolve a postcode to a zone id via the configured ranges. Cross-zone
 * overlap is allowed; the first match ordered by zone name (then id, for
 * stability) wins. Returns null when the postcode is invalid or uncovered.
 */
export function matchZone(
  postcode: string,
  ranges: ZonePostcodeRange[],
  zones: DeliveryZone[],
): string | null {
  if (!isValidPostcode(postcode)) return null;

  const zoneById = new Map(zones.map((z) => [z.id, z]));
  const matched = ranges.filter(
    (r) =>
      zoneById.has(r.zone_id) &&
      postcode >= r.postcode_start &&
      postcode <= r.postcode_end,
  );
  if (matched.length === 0) return null;

  matched.sort((a, b) => {
    const nameA = zoneById.get(a.zone_id)!.name;
    const nameB = zoneById.get(b.zone_id)!.name;
    return nameA.localeCompare(nameB) || a.zone_id.localeCompare(b.zone_id);
  });
  return matched[0].zone_id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/logistics/tests/unit/postcode.test.ts`
Expected: PASS (8 assertions across 6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/logistics/lib/postcode.ts src/features/logistics/tests/unit/postcode.test.ts
git commit -m "feat(logistics): postcode validation and zone matching"
```

---

### Task 4: Auto-assignment lib

**Files:**
- Create: `src/features/logistics/lib/assignment.ts`
- Test: `src/features/logistics/tests/unit/assignment.test.ts`

**Interfaces:**
- Consumes: `matchZone` from `./postcode`; types from `../types` and `@/features/orders/types`
- Produces:

```ts
export type AssignmentContext = {
  zones: DeliveryZone[];
  ranges: ZonePostcodeRange[];
  truckZones: TruckZone[];
  trucks: DispatchTruck[];
  slots: DeliverySlot[];
  blocks: ScheduleBlock[];
  /** truckId -> count of orders already assigned (source != 'none', status confirmed/ready) on the delivery date */
  loads: Record<string, number>;
};
export type AssignmentResult =
  | { ok: true; truckId: string; zoneId: string }
  | { ok: false; reason: "no_postcode" | "no_zone_match" | "no_covering_truck" | "all_trucks_full" };
export function weekdayOf(dateString: string): number; // "YYYY-MM-DD" -> 0..6, 0=Sunday, timezone-safe
export function suggestTruck(order: { postcode: string | null; delivery_date: string; slot_start_time: string | null }, ctx: AssignmentContext): AssignmentResult;
```

- [ ] **Step 1: Write the failing test**

`src/features/logistics/tests/unit/assignment.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { suggestTruck, weekdayOf, type AssignmentContext } from "../../lib/assignment";
import type { DispatchTruck, ZonePostcodeRange } from "../../types";
import type {
  DeliverySlot,
  DeliveryZone,
  ScheduleBlock,
  TruckZone,
} from "@/features/orders/types";

function zone(id: string, name: string): DeliveryZone {
  return {
    id, organization_id: "org-1", name, display_order: 0, is_active: true,
    created_by: null, created_at: "", updated_at: "", version: 1,
  };
}
function range(zoneId: string, start: string, end: string): ZonePostcodeRange {
  return {
    id: `${zoneId}-${start}`, organization_id: "org-1", zone_id: zoneId,
    postcode_start: start, postcode_end: end, created_by: null, created_at: "",
  };
}
function truck(id: string, code: string, bayId: string | null, active = true): DispatchTruck {
  return {
    id, organization_id: "org-1", name: `Truck ${code}`, code, is_active: active,
    bay_id: bayId, created_by: null, created_at: "", updated_at: "", version: 1,
  };
}
function slot(truckId: string, weekday: number, start: string, maxOrders: number | null): DeliverySlot {
  return {
    id: `slot-${truckId}-${weekday}-${start}`, organization_id: "org-1", truck_id: truckId,
    weekday, start_time: start, end_time: "23:00", max_orders: maxOrders, is_active: true,
    created_by: null, created_at: "", updated_at: "", version: 1,
  };
}
function block(truckId: string | null, date: string): ScheduleBlock {
  return {
    id: `block-${truckId ?? "all"}-${date}`, organization_id: "org-1",
    block_date: date, truck_id: truckId, reason: null, created_by: null, created_at: "",
  };
}

// 2026-08-14 is a Friday -> weekday 5.
const DATE = "2026-08-14";
const WD = 5;

function ctx(overrides: Partial<AssignmentContext> = {}): AssignmentContext {
  const truckZones: TruckZone[] = [
    { truck_id: "t-1", zone_id: "z-south", organization_id: "org-1" },
    { truck_id: "t-2", zone_id: "z-south", organization_id: "org-1" },
  ];
  return {
    zones: [zone("z-south", "South")],
    ranges: [range("z-south", "82000", "82300")],
    truckZones,
    trucks: [truck("t-1", "T1", "bay-1"), truck("t-2", "T2", "bay-1")],
    slots: [slot("t-1", WD, "09:00", 5), slot("t-2", WD, "09:00", 5)],
    blocks: [],
    loads: {},
    ...overrides,
  };
}

const ORDER = { postcode: "82100", delivery_date: DATE, slot_start_time: "09:00" };

describe("weekdayOf", () => {
  it("computes weekday without timezone drift", () => {
    expect(weekdayOf("2026-08-14")).toBe(5); // Friday
    expect(weekdayOf("2026-08-16")).toBe(0); // Sunday
  });
});

describe("suggestTruck", () => {
  it("fails without a postcode", () => {
    const result = suggestTruck({ ...ORDER, postcode: null }, ctx());
    expect(result).toEqual({ ok: false, reason: "no_postcode" });
  });

  it("fails when no zone covers the postcode", () => {
    const result = suggestTruck({ ...ORDER, postcode: "50000" }, ctx());
    expect(result).toEqual({ ok: false, reason: "no_zone_match" });
  });

  it("picks the least-loaded covering truck", () => {
    const result = suggestTruck(ORDER, ctx({ loads: { "t-1": 3, "t-2": 1 } }));
    expect(result).toEqual({ ok: true, truckId: "t-2", zoneId: "z-south" });
  });

  it("breaks load ties by lowest truck code", () => {
    const result = suggestTruck(ORDER, ctx({ loads: { "t-1": 2, "t-2": 2 } }));
    expect(result).toEqual({ ok: true, truckId: "t-1", zoneId: "z-south" });
  });

  it("skips inactive trucks", () => {
    const result = suggestTruck(
      ORDER,
      ctx({ trucks: [truck("t-1", "T1", "bay-1", false), truck("t-2", "T2", "bay-1")] }),
    );
    expect(result).toEqual({ ok: true, truckId: "t-2", zoneId: "z-south" });
  });

  it("skips trucks without a bay", () => {
    const result = suggestTruck(
      ORDER,
      ctx({ trucks: [truck("t-1", "T1", null), truck("t-2", "T2", "bay-1")] }),
    );
    expect(result).toEqual({ ok: true, truckId: "t-2", zoneId: "z-south" });
  });

  it("skips trucks blocked on the delivery date, and treats a null-truck block as blocking all", () => {
    const perTruck = suggestTruck(ORDER, ctx({ blocks: [block("t-1", DATE)] }));
    expect(perTruck).toEqual({ ok: true, truckId: "t-2", zoneId: "z-south" });

    const allBlocked = suggestTruck(ORDER, ctx({ blocks: [block(null, DATE)] }));
    expect(allBlocked).toEqual({ ok: false, reason: "no_covering_truck" });
  });

  it("skips trucks with no matching active slot for the order's weekday and start time", () => {
    const result = suggestTruck(ORDER, ctx({ slots: [slot("t-2", WD, "09:00", 5)] }));
    expect(result).toEqual({ ok: true, truckId: "t-2", zoneId: "z-south" });
  });

  it("skips trucks at their slot max_orders cap; null cap means unlimited", () => {
    const capped = suggestTruck(
      ORDER,
      ctx({ slots: [slot("t-1", WD, "09:00", 2), slot("t-2", WD, "09:00", 2)], loads: { "t-1": 2, "t-2": 1 } }),
    );
    expect(capped).toEqual({ ok: true, truckId: "t-2", zoneId: "z-south" });

    const allFull = suggestTruck(
      ORDER,
      ctx({ slots: [slot("t-1", WD, "09:00", 1), slot("t-2", WD, "09:00", 1)], loads: { "t-1": 1, "t-2": 1 } }),
    );
    expect(allFull).toEqual({ ok: false, reason: "all_trucks_full" });

    const unlimited = suggestTruck(
      ORDER,
      ctx({ slots: [slot("t-1", WD, "09:00", null)], trucks: [truck("t-1", "T1", "bay-1")], loads: { "t-1": 99 } }),
    );
    expect(unlimited).toEqual({ ok: true, truckId: "t-1", zoneId: "z-south" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/logistics/tests/unit/assignment.test.ts`
Expected: FAIL — cannot resolve `../../lib/assignment`.

- [ ] **Step 3: Write `src/features/logistics/lib/assignment.ts`**

```ts
/**
 * Pure auto-assignment: pick the best truck for an order. No DB access —
 * the server action loads the context and applies the result. Manual
 * assignments are never overwritten here or in the RPC
 * (dispatch_assign_order ignores p_source='auto' over 'manual').
 *
 * A truck is a candidate when it: is active, sits in a bay, covers the
 * order's zone, is not blocked on the delivery date, and has an active
 * slot matching the order's weekday + start time. Among candidates under
 * their slot cap, least-loaded wins; ties break by lowest truck code.
 */

import type {
  DeliverySlot,
  DeliveryZone,
  ScheduleBlock,
  TruckZone,
} from "@/features/orders/types";
import type { DispatchTruck, ZonePostcodeRange } from "../types";
import { matchZone } from "./postcode";

export type AssignmentContext = {
  zones: DeliveryZone[];
  ranges: ZonePostcodeRange[];
  truckZones: TruckZone[];
  trucks: DispatchTruck[];
  slots: DeliverySlot[];
  blocks: ScheduleBlock[];
  loads: Record<string, number>;
};

export type AssignmentResult =
  | { ok: true; truckId: string; zoneId: string }
  | { ok: false; reason: "no_postcode" | "no_zone_match" | "no_covering_truck" | "all_trucks_full" };

/** "YYYY-MM-DD" -> 0..6 (0=Sunday). Parses as local date parts, no UTC drift. */
export function weekdayOf(dateString: string): number {
  const [y, m, d] = dateString.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

export function suggestTruck(
  order: { postcode: string | null; delivery_date: string; slot_start_time: string | null },
  ctx: AssignmentContext,
): AssignmentResult {
  if (!order.postcode) return { ok: false, reason: "no_postcode" };

  const zoneId = matchZone(order.postcode, ctx.ranges, ctx.zones);
  if (!zoneId) return { ok: false, reason: "no_zone_match" };

  const weekday = weekdayOf(order.delivery_date);
  const coveringIds = new Set(
    ctx.truckZones.filter((tz) => tz.zone_id === zoneId).map((tz) => tz.truck_id),
  );
  const blockedAll = ctx.blocks.some(
    (b) => b.block_date === order.delivery_date && b.truck_id === null,
  );
  const blockedIds = new Set(
    ctx.blocks
      .filter((b) => b.block_date === order.delivery_date && b.truck_id !== null)
      .map((b) => b.truck_id as string),
  );

  const slotFor = (truckId: string): DeliverySlot | undefined =>
    ctx.slots.find(
      (s) =>
        s.truck_id === truckId &&
        s.is_active &&
        s.weekday === weekday &&
        (order.slot_start_time === null || s.start_time.startsWith(order.slot_start_time)),
    );

  const candidates = ctx.trucks.filter(
    (t) =>
      t.is_active &&
      t.bay_id !== null &&
      coveringIds.has(t.id) &&
      !blockedAll &&
      !blockedIds.has(t.id) &&
      slotFor(t.id) !== undefined,
  );
  if (candidates.length === 0) return { ok: false, reason: "no_covering_truck" };

  const underCap = candidates.filter((t) => {
    const cap = slotFor(t.id)!.max_orders;
    return cap === null || (ctx.loads[t.id] ?? 0) < cap;
  });
  if (underCap.length === 0) return { ok: false, reason: "all_trucks_full" };

  underCap.sort(
    (a, b) => (ctx.loads[a.id] ?? 0) - (ctx.loads[b.id] ?? 0) || a.code.localeCompare(b.code),
  );
  return { ok: true, truckId: underCap[0].id, zoneId };
}
```

Note: `s.start_time.startsWith(order.slot_start_time)` — Postgres `time` comes back as `"09:00:00"` while inputs may carry `"09:00"`; startsWith handles both.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/logistics/tests/unit/assignment.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/logistics/lib/assignment.ts src/features/logistics/tests/unit/assignment.test.ts
git commit -m "feat(logistics): pure auto-assignment with least-loaded pick"
```

---

### Task 5: Dispatch drop rules

**Files:**
- Create: `src/features/logistics/lib/dispatch-rules.ts`
- Test: `src/features/logistics/tests/unit/dispatch-rules.test.ts`

**Interfaces:**
- Consumes: `OrderStatus`, `RunStatus` from `@/features/orders/types`
- Produces:

```ts
export type DispatchDropTarget =
  | { type: "pool" }
  | { type: "truck"; truckId: string; compatible: boolean; atCapacity: boolean; departed: boolean };
export type DispatchDropResolution =
  | { kind: "noop" }
  | { kind: "assign"; truckId: string }
  | { kind: "override"; truckId: string }
  | { kind: "unassign" }
  | { kind: "blocked"; reason: string };
export function resolveDispatchDrop(ticket: { status: OrderStatus; assignedTruckId: string | null; runStatus: RunStatus | null }, target: DispatchDropTarget): DispatchDropResolution;
```

(`assignedTruckId` = the truck the board currently shows the ticket on: `order.truck_id` when `assignment_source !== 'none'`, else `null`.)

- [ ] **Step 1: Write the failing test**

`src/features/logistics/tests/unit/dispatch-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveDispatchDrop, type DispatchDropTarget } from "../../lib/dispatch-rules";

const truckTarget = (over: Partial<Extract<DispatchDropTarget, { type: "truck" }>> = {}): DispatchDropTarget => ({
  type: "truck",
  truckId: "t-1",
  compatible: true,
  atCapacity: false,
  departed: false,
  ...over,
});

describe("resolveDispatchDrop", () => {
  it("assigns a confirmed ticket to a compatible truck", () => {
    const result = resolveDispatchDrop(
      { status: "confirmed", assignedTruckId: null, runStatus: null },
      truckTarget(),
    );
    expect(result).toEqual({ kind: "assign", truckId: "t-1" });
  });

  it("no-ops when dropped on the truck it is already on", () => {
    const result = resolveDispatchDrop(
      { status: "ready", assignedTruckId: "t-1", runStatus: "planned" },
      truckTarget(),
    );
    expect(result).toEqual({ kind: "noop" });
  });

  it("requires override confirmation for an incompatible truck", () => {
    const result = resolveDispatchDrop(
      { status: "confirmed", assignedTruckId: null, runStatus: null },
      truckTarget({ compatible: false }),
    );
    expect(result).toEqual({ kind: "override", truckId: "t-1" });
  });

  it("blocks a drop onto a full truck", () => {
    const result = resolveDispatchDrop(
      { status: "confirmed", assignedTruckId: null, runStatus: null },
      truckTarget({ atCapacity: true }),
    );
    expect(result).toEqual({ kind: "blocked", reason: "That truck is at its slot capacity for this date." });
  });

  it("blocks a drop onto a departed truck", () => {
    const result = resolveDispatchDrop(
      { status: "ready", assignedTruckId: null, runStatus: null },
      truckTarget({ departed: true }),
    );
    expect(result).toEqual({ kind: "blocked", reason: "That truck has already departed." });
  });

  it("blocks moving a ticket whose run has departed", () => {
    const result = resolveDispatchDrop(
      { status: "ready", assignedTruckId: "t-2", runStatus: "departed" },
      truckTarget(),
    );
    expect(result).toEqual({ kind: "blocked", reason: "This order is on a departed run and can no longer be moved." });
  });

  it("blocks tickets that are not confirmed or ready", () => {
    const result = resolveDispatchDrop(
      { status: "pending", assignedTruckId: null, runStatus: null },
      truckTarget(),
    );
    expect(result).toEqual({ kind: "blocked", reason: "Only confirmed or ready orders can be dispatched." });
  });

  it("unassigns when an assigned ticket is dropped on the pool", () => {
    const result = resolveDispatchDrop(
      { status: "confirmed", assignedTruckId: "t-1", runStatus: "planned" },
      { type: "pool" },
    );
    expect(result).toEqual({ kind: "unassign" });
  });

  it("no-ops when an unassigned ticket is dropped on the pool", () => {
    const result = resolveDispatchDrop(
      { status: "confirmed", assignedTruckId: null, runStatus: null },
      { type: "pool" },
    );
    expect(result).toEqual({ kind: "noop" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/logistics/tests/unit/dispatch-rules.test.ts`
Expected: FAIL — cannot resolve `../../lib/dispatch-rules`.

- [ ] **Step 3: Write `src/features/logistics/lib/dispatch-rules.ts`**

```ts
/**
 * Pure drop rules for the dispatch board, mirroring the orders kanban's
 * board-rules.ts: a drag never writes state directly — it resolves to an
 * action (assign/unassign), a confirmation workflow (override), or a
 * blocked reason shown as a toast.
 */

import type { OrderStatus, RunStatus } from "@/features/orders/types";

export type DispatchDropTarget =
  | { type: "pool" }
  | { type: "truck"; truckId: string; compatible: boolean; atCapacity: boolean; departed: boolean };

export type DispatchDropResolution =
  | { kind: "noop" }
  | { kind: "assign"; truckId: string }
  | { kind: "override"; truckId: string }
  | { kind: "unassign" }
  | { kind: "blocked"; reason: string };

export function resolveDispatchDrop(
  ticket: { status: OrderStatus; assignedTruckId: string | null; runStatus: RunStatus | null },
  target: DispatchDropTarget,
): DispatchDropResolution {
  if (ticket.status !== "confirmed" && ticket.status !== "ready") {
    return { kind: "blocked", reason: "Only confirmed or ready orders can be dispatched." };
  }
  if (ticket.runStatus === "departed") {
    return { kind: "blocked", reason: "This order is on a departed run and can no longer be moved." };
  }

  if (target.type === "pool") {
    return ticket.assignedTruckId === null ? { kind: "noop" } : { kind: "unassign" };
  }

  if (ticket.assignedTruckId === target.truckId) return { kind: "noop" };
  if (target.departed) {
    return { kind: "blocked", reason: "That truck has already departed." };
  }
  if (target.atCapacity) {
    return { kind: "blocked", reason: "That truck is at its slot capacity for this date." };
  }
  if (!target.compatible) return { kind: "override", truckId: target.truckId };
  return { kind: "assign", truckId: target.truckId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/logistics/tests/unit/dispatch-rules.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/logistics/lib/dispatch-rules.ts src/features/logistics/tests/unit/dispatch-rules.test.ts
git commit -m "feat(logistics): dispatch drop resolution rules"
```

---

### Task 6: Dispatch board view model

**Files:**
- Create: `src/features/logistics/lib/dispatch-board-model.ts`
- Test: `src/features/logistics/tests/unit/dispatch-board-model.test.ts`

**Interfaces:**
- Consumes: `DispatchBoardData`, `DispatchTicket`, `DispatchTruck`, `Bay` from `../types`; `matchZone` from `./postcode`; `weekdayOf` from `./assignment`
- Produces:

```ts
export type BoardTruck = {
  truck: DispatchTruck;
  run: DeliveryRun | null;         // run for the board date
  departed: boolean;
  tickets: DispatchTicket[];       // assigned, source != 'none', sorted by slot time then customer name
  load: number;                    // tickets.length
  cap: number | null;              // max_orders of the truck's slot for that weekday (min across matching active slots), null = unlimited
};
export type BoardBay = { bay: Bay; trucks: BoardTruck[] };
export type DispatchBoardView = {
  pool: DispatchTicket[];          // source='none' OR truck missing/inactive/off-board
  bays: BoardBay[];                // active bays by position
};
export function buildBoardView(data: DispatchBoardData, date: string): DispatchBoardView;
export function compatibleTruckIds(ticket: DispatchTicket, data: DispatchBoardData): Set<string>;
```

- [ ] **Step 1: Write the failing test**

`src/features/logistics/tests/unit/dispatch-board-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildBoardView, compatibleTruckIds } from "../../lib/dispatch-board-model";
import type { Bay, DispatchBoardData, DispatchTicket, DispatchTruck } from "../../types";

const DATE = "2026-08-14"; // Friday, weekday 5

function bay(id: string, name: string, position: number, active = true): Bay {
  return {
    id, organization_id: "org-1", facility_id: "fac-1", name, position,
    is_active: active, created_by: null, created_at: "", updated_at: "", version: 1,
  };
}
function truck(id: string, code: string, bayId: string | null, active = true): DispatchTruck {
  return {
    id, organization_id: "org-1", name: `Truck ${code}`, code, is_active: active,
    bay_id: bayId, created_by: null, created_at: "", updated_at: "", version: 1,
  };
}
function ticket(id: string, truckId: string, source: "none" | "auto" | "manual", status: "confirmed" | "ready" = "confirmed"): DispatchTicket {
  return {
    id, organization_id: "org-1", customer_id: "cust-1", created_by: null,
    source: "portal", status, zone_id: "z-south", delivery_address: "addr",
    delivery_date: DATE, slot_id: "slot-1", truck_id: truckId, run_id: null,
    notes: null, total_amount: 0, closed_at: null, created_at: "", updated_at: "",
    version: 1, postcode: "82100", assignment_source: source,
    customer: { name: `Customer ${id}` },
  };
}

function data(overrides: Partial<DispatchBoardData> = {}): DispatchBoardData {
  return {
    facility: null,
    bays: [bay("bay-2", "Bay 2", 2), bay("bay-1", "Bay 1", 1)],
    trucks: [truck("t-1", "T1", "bay-1"), truck("t-2", "T2", "bay-2")],
    zones: [{
      id: "z-south", organization_id: "org-1", name: "South", display_order: 0,
      is_active: true, created_by: null, created_at: "", updated_at: "", version: 1,
    }],
    ranges: [{
      id: "r-1", organization_id: "org-1", zone_id: "z-south",
      postcode_start: "82000", postcode_end: "82300", created_by: null, created_at: "",
    }],
    truckZones: [{ truck_id: "t-1", zone_id: "z-south", organization_id: "org-1" }],
    slots: [{
      id: "slot-1", organization_id: "org-1", truck_id: "t-1", weekday: 5,
      start_time: "09:00:00", end_time: "12:00:00", max_orders: 5, is_active: true,
      created_by: null, created_at: "", updated_at: "", version: 1,
    }],
    blocks: [],
    runs: [],
    orders: [],
    ...overrides,
  };
}

describe("buildBoardView", () => {
  it("orders bays by position", () => {
    const view = buildBoardView(data(), DATE);
    expect(view.bays.map((b) => b.bay.id)).toEqual(["bay-1", "bay-2"]);
  });

  it("puts source='none' tickets in the pool and assigned tickets on their truck", () => {
    const view = buildBoardView(
      data({ orders: [ticket("o-1", "t-1", "none"), ticket("o-2", "t-1", "auto")] }),
      DATE,
    );
    expect(view.pool.map((t) => t.id)).toEqual(["o-1"]);
    const t1 = view.bays[0].trucks.find((t) => t.truck.id === "t-1")!;
    expect(t1.tickets.map((t) => t.id)).toEqual(["o-2"]);
    expect(t1.load).toBe(1);
    expect(t1.cap).toBe(5);
  });

  it("sends tickets on an inactive truck back to the pool", () => {
    const view = buildBoardView(
      data({
        trucks: [truck("t-1", "T1", "bay-1", false), truck("t-2", "T2", "bay-2")],
        orders: [ticket("o-1", "t-1", "manual")],
      }),
      DATE,
    );
    expect(view.pool.map((t) => t.id)).toEqual(["o-1"]);
  });

  it("marks a truck departed when its run for the date is departed", () => {
    const view = buildBoardView(
      data({
        runs: [{
          id: "run-1", organization_id: "org-1", truck_id: "t-1", run_date: DATE,
          status: "departed", notes: null, created_at: "", updated_at: "", version: 1,
        }],
      }),
      DATE,
    );
    const t1 = view.bays[0].trucks.find((t) => t.truck.id === "t-1")!;
    expect(t1.departed).toBe(true);
    expect(t1.run?.id).toBe("run-1");
  });
});

describe("compatibleTruckIds", () => {
  it("returns trucks covering the ticket's matched zone", () => {
    const ids = compatibleTruckIds(ticket("o-1", "t-1", "none"), data());
    expect(ids).toEqual(new Set(["t-1"]));
  });

  it("returns an empty set when the postcode matches no zone", () => {
    const t = { ...ticket("o-1", "t-1", "none"), postcode: "50000" };
    expect(compatibleTruckIds(t, data())).toEqual(new Set());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/logistics/tests/unit/dispatch-board-model.test.ts`
Expected: FAIL — cannot resolve `../../lib/dispatch-board-model`.

- [ ] **Step 3: Write `src/features/logistics/lib/dispatch-board-model.ts`**

```ts
/**
 * Pure view model for the dispatch board. Groups the raw board data into
 * bays -> trucks -> tickets, and derives the pool. Display-level safety
 * net: tickets whose truck is inactive, bay-less, or missing render in the
 * pool even if assignment_source says assigned — the data stays untouched,
 * the board just refuses to show a ticket on an undispatchable truck.
 */

import type { DeliveryRun } from "@/features/orders/types";
import type { Bay, DispatchBoardData, DispatchTicket, DispatchTruck } from "../types";
import { weekdayOf } from "./assignment";
import { matchZone } from "./postcode";

export type BoardTruck = {
  truck: DispatchTruck;
  run: DeliveryRun | null;
  departed: boolean;
  tickets: DispatchTicket[];
  load: number;
  cap: number | null;
};

export type BoardBay = { bay: Bay; trucks: BoardTruck[] };

export type DispatchBoardView = {
  pool: DispatchTicket[];
  bays: BoardBay[];
};

export function buildBoardView(data: DispatchBoardData, date: string): DispatchBoardView {
  const weekday = weekdayOf(date);
  const truckById = new Map(data.trucks.map((t) => [t.id, t]));
  const onBoard = (t: DispatchTruck | undefined): t is DispatchTruck =>
    t !== undefined && t.is_active && t.bay_id !== null;

  const pool: DispatchTicket[] = [];
  const byTruck = new Map<string, DispatchTicket[]>();
  for (const order of data.orders) {
    const assignedTruck = truckById.get(order.truck_id);
    if (order.assignment_source === "none" || !onBoard(assignedTruck)) {
      pool.push(order);
    } else {
      const list = byTruck.get(order.truck_id) ?? [];
      list.push(order);
      byTruck.set(order.truck_id, list);
    }
  }

  const ticketSort = (a: DispatchTicket, b: DispatchTicket) =>
    a.delivery_date.localeCompare(b.delivery_date) ||
    (a.customer?.name ?? "").localeCompare(b.customer?.name ?? "");
  pool.sort(ticketSort);

  const capFor = (truckId: string): number | null => {
    const caps = data.slots
      .filter((s) => s.truck_id === truckId && s.is_active && s.weekday === weekday)
      .map((s) => s.max_orders);
    const bounded = caps.filter((c): c is number => c !== null);
    if (caps.length === 0 || bounded.length === 0) return null;
    return Math.min(...bounded);
  };

  const bays: BoardBay[] = data.bays
    .filter((b) => b.is_active)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((b) => ({
      bay: b,
      trucks: data.trucks
        .filter((t) => t.bay_id === b.id && t.is_active)
        .sort((a, z) => a.code.localeCompare(z.code))
        .map((t) => {
          const run = data.runs.find((r) => r.truck_id === t.id && r.run_date === date) ?? null;
          const tickets = (byTruck.get(t.id) ?? []).sort(ticketSort);
          return {
            truck: t,
            run,
            departed: run?.status === "departed" || run?.status === "completed",
            tickets,
            load: tickets.length,
            cap: capFor(t.id),
          };
        }),
    }));

  return { pool, bays };
}

/** Trucks whose zone coverage includes the ticket's matched zone. */
export function compatibleTruckIds(
  ticket: DispatchTicket,
  data: DispatchBoardData,
): Set<string> {
  if (!ticket.postcode) return new Set();
  const zoneId = matchZone(ticket.postcode, data.ranges, data.zones);
  if (!zoneId) return new Set();
  return new Set(
    data.truckZones.filter((tz) => tz.zone_id === zoneId).map((tz) => tz.truck_id),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/logistics/tests/unit/dispatch-board-model.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/logistics/lib/dispatch-board-model.ts src/features/logistics/tests/unit/dispatch-board-model.test.ts
git commit -m "feat(logistics): dispatch board view model"
```

---

### Task 7: Facility/bay/postcode-range server actions

**Files:**
- Create: `src/features/logistics/server/facility-actions.ts`
- Test: `src/features/logistics/tests/unit/facility-actions.test.ts`

**Interfaces:**
- Consumes: `requireOrgRole`, `OrderPermissionError` from `@/features/orders/server/guards`; `FACILITY_ADMIN_ROLES` from `../lib/roles`; `MANAGER_ROLES` from `@/features/orders/lib/roles`; schemas from `../types`
- Produces server actions: `getLogisticsSetup(slug)`, `updateFacility(slug, facilityId, rawInput)`, `createBay(slug, rawInput)`, `updateBay(slug, bayId, rawInput)`, `deleteBay(slug, bayId)`, `setTruckBay(slug, truckId, bayId | null)`, `addPostcodeRange(slug, rawInput)`, `deletePostcodeRange(slug, rangeId)`

- [ ] **Step 1: Write the failing test**

`src/features/logistics/tests/unit/facility-actions.test.ts` — copy the `chain`/`mockSupabaseFor` helpers verbatim from `src/features/orders/tests/unit/schedule-actions.test.ts` (lines 17–90), then:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { updateFacility, createBay, addPostcodeRange } from "../../server/facility-actions";

// ... chain() and mockSupabaseFor() copied from schedule-actions.test.ts ...

beforeEach(() => {
  vi.mocked(createSupabaseServerClient).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("updateFacility", () => {
  it("returns forbidden for a seller (managers are NOT facility admins)", async () => {
    mockSupabaseFor({ role: "seller" });

    const result = await updateFacility("ayam-norliza-pilot", "fac-1", {
      name: "Kilang Ayam",
      addressLine: "Ptd 7904",
      postcode: "82000",
      state: "Johor",
    });

    expect(result).toEqual({ ok: false, code: "forbidden", message: expect.any(String) });
  });

  it("updates the facility for an owner", async () => {
    mockSupabaseFor({
      role: "owner",
      tableResults: {
        facilities: {
          data: {
            id: "fac-1", organization_id: "org-1", name: "Kilang Ayam",
            address_line: "Ptd 7904", postcode: "82000", state: "Johor",
            is_active: true, created_by: null,
            created_at: "2026-08-14T00:00:00Z", updated_at: "2026-08-14T00:00:00Z", version: 1,
          },
          error: null,
        },
      },
    });

    const result = await updateFacility("ayam-norliza-pilot", "fac-1", {
      name: "Kilang Ayam",
      addressLine: "Ptd 7904",
      postcode: "82000",
      state: "Johor",
    });

    expect(result).toEqual({ ok: true, data: expect.objectContaining({ id: "fac-1" }) });
  });

  it("rejects a bad postcode with a validation error", async () => {
    mockSupabaseFor({ role: "owner" });

    const result = await updateFacility("ayam-norliza-pilot", "fac-1", {
      name: "Kilang Ayam",
      addressLine: "Ptd 7904",
      postcode: "820",
      state: "Johor",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("validation");
  });
});

describe("createBay", () => {
  it("allows managers (seller) to create a bay", async () => {
    mockSupabaseFor({
      role: "seller",
      tableResults: {
        bays: {
          data: {
            id: "bay-1", organization_id: "org-1", facility_id: "fac-1",
            name: "Bay 1", position: 0, is_active: true, created_by: "user-1",
            created_at: "2026-08-14T00:00:00Z", updated_at: "2026-08-14T00:00:00Z", version: 1,
          },
          error: null,
        },
      },
    });

    const result = await createBay("ayam-norliza-pilot", {
      facilityId: "5b1f5c1e-0000-4000-8000-000000000001",
      name: "Bay 1",
    });

    expect(result).toEqual({ ok: true, data: expect.objectContaining({ id: "bay-1" }) });
  });
});

describe("addPostcodeRange", () => {
  it("rejects end < start", async () => {
    mockSupabaseFor({ role: "owner" });

    const result = await addPostcodeRange("ayam-norliza-pilot", {
      zoneId: "5b1f5c1e-0000-4000-8000-000000000001",
      postcodeStart: "82300",
      postcodeEnd: "82000",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("validation");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/logistics/tests/unit/facility-actions.test.ts`
Expected: FAIL — cannot resolve `../../server/facility-actions`.

- [ ] **Step 3: Write `src/features/logistics/server/facility-actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireOrgRole, OrderPermissionError } from "@/features/orders/server/guards";
import { MANAGER_ROLES } from "@/features/orders/lib/roles";
import type { ActionResult } from "@/features/orders/types";
import { FACILITY_ADMIN_ROLES } from "../lib/roles";
import {
  BayInputSchema,
  FacilityInputSchema,
  PostcodeRangeInputSchema,
  type Bay,
  type Facility,
  type ZonePostcodeRange,
} from "../types";

type LogisticsErrorCode = "forbidden" | "validation" | "not_found" | "conflict" | "internal";

function err<T = never>(
  code: LogisticsErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): ActionResult<T> {
  return { ok: false, code, message, ...(fieldErrors ? { fieldErrors } : {}) };
}

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

async function guardRoles(
  organizationSlug: string,
  roles: readonly string[],
): Promise<
  | { ok: true; orgId: string; userId: string }
  | { ok: false; code: "forbidden"; message: string }
> {
  try {
    const ctx = await requireOrgRole(organizationSlug, roles);
    return { ok: true, orgId: ctx.orgId, userId: ctx.userId };
  } catch (e) {
    if (e instanceof OrderPermissionError) {
      return { ok: false, code: "forbidden", message: e.message };
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Logistics setup (read: facility + bays + postcode ranges)
// ---------------------------------------------------------------------------

export type LogisticsSetup = {
  facility: Facility | null;
  bays: Bay[];
  ranges: ZonePostcodeRange[];
};

export async function getLogisticsSetup(
  organizationSlug: string,
): Promise<ActionResult<LogisticsSetup>> {
  const guard = await guardRoles(organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  const [facility, bays, ranges] = await Promise.all([
    supabase
      .from("facilities")
      .select("*")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase.from("bays").select("*").eq("organization_id", orgId).order("position", { ascending: true }),
    supabase.from("zone_postcode_ranges").select("*").eq("organization_id", orgId).order("postcode_start", { ascending: true }),
  ]);

  if (facility.error || bays.error || ranges.error) {
    return err("internal", "Failed to load logistics setup");
  }

  return ok({
    facility: (facility.data ?? null) as Facility | null,
    bays: (bays.data ?? []) as Bay[],
    ranges: (ranges.data ?? []) as ZonePostcodeRange[],
  });
}

// ---------------------------------------------------------------------------
// Facility (owner/org_admin only)
// ---------------------------------------------------------------------------

export async function updateFacility(
  organizationSlug: string,
  facilityId: string,
  rawInput: unknown,
): Promise<ActionResult<Facility>> {
  const guard = await guardRoles(organizationSlug, FACILITY_ADMIN_ROLES);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const parsed = FacilityInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid facility input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("facilities")
    .update({
      name: input.name,
      address_line: input.addressLine,
      postcode: input.postcode,
      state: input.state,
    })
    .eq("id", facilityId)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error || !data) {
    return err("internal", error?.message ?? "Failed to update facility");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(data as Facility);
}

// ---------------------------------------------------------------------------
// Bays (managers)
// ---------------------------------------------------------------------------

export async function createBay(
  organizationSlug: string,
  rawInput: unknown,
): Promise<ActionResult<Bay>> {
  const guard = await guardRoles(organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;
  const { orgId, userId } = guard;

  const parsed = BayInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid bay input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("bays")
    .insert({
      organization_id: orgId,
      facility_id: input.facilityId,
      name: input.name,
      position: input.position,
      is_active: input.isActive,
      created_by: userId,
    })
    .select()
    .single();

  if (error || !data) {
    return err("internal", error?.message ?? "Failed to create bay");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(data as Bay);
}

export async function updateBay(
  organizationSlug: string,
  bayId: string,
  rawInput: unknown,
): Promise<ActionResult<Bay>> {
  const guard = await guardRoles(organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const parsed = BayInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid bay input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("bays")
    .update({
      name: input.name,
      position: input.position,
      is_active: input.isActive,
    })
    .eq("id", bayId)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error || !data) {
    return err("internal", error?.message ?? "Failed to update bay");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(data as Bay);
}

export async function deleteBay(
  organizationSlug: string,
  bayId: string,
): Promise<ActionResult> {
  const guard = await guardRoles(organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("bays")
    .delete()
    .eq("id", bayId)
    .eq("organization_id", orgId);

  if (error) {
    return err("internal", error.message);
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(undefined);
}

export async function setTruckBay(
  organizationSlug: string,
  truckId: string,
  bayId: string | null,
): Promise<ActionResult> {
  const guard = await guardRoles(organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const parsed = z.string().uuid().nullable().safeParse(bayId);
  if (!parsed.success) {
    return err("validation", "Invalid bay selection");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("trucks")
    .update({ bay_id: parsed.data })
    .eq("id", truckId)
    .eq("organization_id", orgId);

  if (error) {
    return err("internal", error.message);
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Zone postcode ranges (managers; insert/delete only)
// ---------------------------------------------------------------------------

export async function addPostcodeRange(
  organizationSlug: string,
  rawInput: unknown,
): Promise<ActionResult<ZonePostcodeRange>> {
  const guard = await guardRoles(organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;
  const { orgId, userId } = guard;

  const parsed = PostcodeRangeInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid postcode range", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("zone_postcode_ranges")
    .insert({
      organization_id: orgId,
      zone_id: input.zoneId,
      postcode_start: input.postcodeStart,
      postcode_end: input.postcodeEnd,
      created_by: userId,
    })
    .select()
    .single();

  if (error || !data) {
    return err("internal", error?.message ?? "Failed to add postcode range");
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(data as ZonePostcodeRange);
}

export async function deletePostcodeRange(
  organizationSlug: string,
  rangeId: string,
): Promise<ActionResult> {
  const guard = await guardRoles(organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("zone_postcode_ranges")
    .delete()
    .eq("id", rangeId)
    .eq("organization_id", orgId);

  if (error) {
    return err("internal", error.message);
  }

  revalidatePath(`/${organizationSlug}/delivery`);
  return ok(undefined);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/logistics/tests/unit/facility-actions.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/logistics/server/facility-actions.ts src/features/logistics/tests/unit/facility-actions.test.ts
git commit -m "feat(logistics): facility, bay, and postcode-range server actions"
```

---

### Task 8: Dispatch server actions

**Files:**
- Create: `src/features/logistics/server/dispatch-actions.ts`
- Test: `src/features/logistics/tests/unit/dispatch-actions.test.ts`

**Interfaces:**
- Consumes: `DISPATCH_ROLES` from `../lib/roles`; `suggestTruck`/`AssignmentContext` from `../lib/assignment`; RPCs `dispatch_assign_order`, `dispatch_unassign_order`, `set_run_status`
- Produces server actions:
  - `getDispatchBoard(slug, date)` → `ActionResult<DispatchBoardData>`
  - `assignOrder(slug, { orderId, truckId })` → manual assign via RPC
  - `unassignOrder(slug, { orderId })`
  - `autoAssignOrder(slug, orderId)` → computes suggestion, RPC with `'auto'`; returns `ActionResult<{ assigned: boolean; reason?: string }>` — an unassignable order is `ok: true, assigned: false` (not an error)
  - `departTruck(slug, { truckId, date })` → finds the truck+date run, RPC `set_run_status(run, 'departed')`

- [ ] **Step 1: Write the failing test**

`src/features/logistics/tests/unit/dispatch-actions.test.ts` — same mock helpers copied from `schedule-actions.test.ts` (the `rpc` mock on the client is already in `mockSupabaseFor`; capture the returned client to configure it):

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assignOrder, unassignOrder, departTruck } from "../../server/dispatch-actions";

// ... chain() and mockSupabaseFor() copied from schedule-actions.test.ts ...

beforeEach(() => {
  vi.mocked(createSupabaseServerClient).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("assignOrder", () => {
  it("allows logistics staff and calls the RPC with source manual", async () => {
    const supabase = mockSupabaseFor({ role: "logistics" });
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    const result = await assignOrder("ayam-norliza-pilot", {
      orderId: "5b1f5c1e-0000-4000-8000-000000000001",
      truckId: "5b1f5c1e-0000-4000-8000-000000000002",
    });

    expect(result.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("dispatch_assign_order", {
      p_order: "5b1f5c1e-0000-4000-8000-000000000001",
      p_truck: "5b1f5c1e-0000-4000-8000-000000000002",
      p_source: "manual",
    });
  });

  it("maps run_departed RPC error to a conflict", async () => {
    const supabase = mockSupabaseFor({ role: "owner" });
    supabase.rpc.mockResolvedValue({ data: null, error: { message: "run_departed" } });

    const result = await assignOrder("ayam-norliza-pilot", {
      orderId: "5b1f5c1e-0000-4000-8000-000000000001",
      truckId: "5b1f5c1e-0000-4000-8000-000000000002",
    });

    expect(result).toEqual({
      ok: false,
      code: "conflict",
      message: "That run has already departed.",
    });
  });

  it("returns forbidden for warehouse-only roles", async () => {
    mockSupabaseFor({ role: "inventory" });

    const result = await assignOrder("ayam-norliza-pilot", {
      orderId: "5b1f5c1e-0000-4000-8000-000000000001",
      truckId: "5b1f5c1e-0000-4000-8000-000000000002",
    });

    expect(result).toEqual({ ok: false, code: "forbidden", message: expect.any(String) });
  });
});

describe("unassignOrder", () => {
  it("calls the unassign RPC", async () => {
    const supabase = mockSupabaseFor({ role: "seller" });
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    const result = await unassignOrder("ayam-norliza-pilot", {
      orderId: "5b1f5c1e-0000-4000-8000-000000000001",
    });

    expect(result.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("dispatch_unassign_order", {
      p_order: "5b1f5c1e-0000-4000-8000-000000000001",
    });
  });
});

describe("departTruck", () => {
  it("errors when no run exists for the truck and date", async () => {
    const supabase = mockSupabaseFor({
      role: "logistics",
      tableResults: { delivery_runs: { data: null, error: null } },
    });
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    const result = await departTruck("ayam-norliza-pilot", {
      truckId: "5b1f5c1e-0000-4000-8000-000000000002",
      date: "2026-08-14",
    });

    expect(result).toEqual({
      ok: false,
      code: "not_found",
      message: "No delivery run exists for this truck on this date.",
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("departs the run via set_run_status", async () => {
    const supabase = mockSupabaseFor({
      role: "logistics",
      tableResults: { delivery_runs: { data: { id: "run-1" }, error: null } },
    });
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    const result = await departTruck("ayam-norliza-pilot", {
      truckId: "5b1f5c1e-0000-4000-8000-000000000002",
      date: "2026-08-14",
    });

    expect(result.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith("set_run_status", {
      p_run: "run-1",
      p_status: "departed",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/logistics/tests/unit/dispatch-actions.test.ts`
Expected: FAIL — cannot resolve `../../server/dispatch-actions`.

- [ ] **Step 3: Write `src/features/logistics/server/dispatch-actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireOrgRole, OrderPermissionError } from "@/features/orders/server/guards";
import type { ActionResult } from "@/features/orders/types";
import { suggestTruck, type AssignmentContext } from "../lib/assignment";
import { DISPATCH_ROLES } from "../lib/roles";
import type { DispatchBoardData, DispatchTicket, DispatchTruck, Facility, Bay, ZonePostcodeRange } from "../types";

type DispatchErrorCode = "forbidden" | "validation" | "not_found" | "conflict" | "internal";

function err<T = never>(code: DispatchErrorCode, message: string): ActionResult<T> {
  return { ok: false, code, message };
}

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

async function guardDispatch(
  organizationSlug: string,
): Promise<
  | { ok: true; orgId: string; userId: string }
  | { ok: false; code: "forbidden"; message: string }
> {
  try {
    const ctx = await requireOrgRole(organizationSlug, DISPATCH_ROLES);
    return { ok: true, orgId: ctx.orgId, userId: ctx.userId };
  } catch (e) {
    if (e instanceof OrderPermissionError) {
      return { ok: false, code: "forbidden", message: e.message };
    }
    throw e;
  }
}

/** Maps RPC P0001 message codes to friendly ActionResults. */
function mapRpcError<T = void>(message: string): ActionResult<T> {
  if (message.includes("run_departed")) return err("conflict", "That run has already departed.");
  if (message.includes("invalid_status")) return err("conflict", "Only confirmed or ready orders can be dispatched.");
  if (message.includes("invalid_truck")) return err("conflict", "That truck is not active in this organization.");
  if (message.includes("forbidden")) return err("forbidden", "You do not have access to dispatch.");
  if (message.includes("not_found")) return err("not_found", "Order not found.");
  return err("internal", message);
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Board read
// ---------------------------------------------------------------------------

export async function getDispatchBoard(
  organizationSlug: string,
  date: string,
): Promise<ActionResult<DispatchBoardData>> {
  const guard = await guardDispatch(organizationSlug);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  if (!DATE_REGEX.test(date)) return err("validation", "Invalid date");

  const supabase = await createSupabaseServerClient();
  const [facility, bays, trucks, zones, ranges, truckZones, slots, blocks, runs, orders] =
    await Promise.all([
      supabase.from("facilities").select("*").eq("organization_id", orgId).eq("is_active", true).limit(1).maybeSingle(),
      supabase.from("bays").select("*").eq("organization_id", orgId).order("position", { ascending: true }),
      supabase.from("trucks").select("*").eq("organization_id", orgId).order("code", { ascending: true }),
      supabase.from("delivery_zones").select("*").eq("organization_id", orgId).order("name", { ascending: true }),
      supabase.from("zone_postcode_ranges").select("*").eq("organization_id", orgId),
      supabase.from("truck_zones").select("*").eq("organization_id", orgId),
      supabase.from("delivery_slots").select("*").eq("organization_id", orgId),
      supabase.from("schedule_blocks").select("*").eq("organization_id", orgId).eq("block_date", date),
      supabase.from("delivery_runs").select("*").eq("organization_id", orgId).eq("run_date", date),
      supabase
        .from("orders")
        .select("*, customer:customers(name), zone:delivery_zones(name)")
        .eq("organization_id", orgId)
        .eq("delivery_date", date)
        .in("status", ["confirmed", "ready"]),
    ]);

  if (
    facility.error || bays.error || trucks.error || zones.error || ranges.error ||
    truckZones.error || slots.error || blocks.error || runs.error || orders.error
  ) {
    return err("internal", "Failed to load the dispatch board");
  }

  return ok({
    facility: (facility.data ?? null) as Facility | null,
    bays: (bays.data ?? []) as Bay[],
    trucks: (trucks.data ?? []) as DispatchTruck[],
    zones: (zones.data ?? []) as DispatchBoardData["zones"],
    ranges: (ranges.data ?? []) as ZonePostcodeRange[],
    truckZones: (truckZones.data ?? []) as DispatchBoardData["truckZones"],
    slots: (slots.data ?? []) as DispatchBoardData["slots"],
    blocks: (blocks.data ?? []) as DispatchBoardData["blocks"],
    runs: (runs.data ?? []) as DispatchBoardData["runs"],
    orders: (orders.data ?? []) as DispatchTicket[],
  });
}

// ---------------------------------------------------------------------------
// Assign / unassign
// ---------------------------------------------------------------------------

const AssignInputSchema = z.object({
  orderId: z.string().uuid(),
  truckId: z.string().uuid(),
});

export async function assignOrder(
  organizationSlug: string,
  rawInput: unknown,
): Promise<ActionResult> {
  const guard = await guardDispatch(organizationSlug);
  if (!guard.ok) return guard;

  const parsed = AssignInputSchema.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid assignment input");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("dispatch_assign_order", {
    p_order: parsed.data.orderId,
    p_truck: parsed.data.truckId,
    p_source: "manual",
  });
  if (error) return mapRpcError(error.message);

  revalidatePath(`/${organizationSlug}/dispatch`);
  return ok(undefined);
}

const UnassignInputSchema = z.object({ orderId: z.string().uuid() });

export async function unassignOrder(
  organizationSlug: string,
  rawInput: unknown,
): Promise<ActionResult> {
  const guard = await guardDispatch(organizationSlug);
  if (!guard.ok) return guard;

  const parsed = UnassignInputSchema.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid input");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("dispatch_unassign_order", {
    p_order: parsed.data.orderId,
  });
  if (error) return mapRpcError(error.message);

  revalidatePath(`/${organizationSlug}/dispatch`);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Auto-assign (called after confirm; also usable from the board)
// ---------------------------------------------------------------------------

export async function autoAssignOrder(
  organizationSlug: string,
  orderId: string,
): Promise<ActionResult<{ assigned: boolean; reason?: string }>> {
  const guard = await guardDispatch(organizationSlug);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, postcode, delivery_date, slot_id, assignment_source, status")
    .eq("id", orderId)
    .eq("organization_id", orgId)
    .single();
  if (orderError || !order) return err("not_found", "Order not found");
  if (order.assignment_source === "manual") return ok({ assigned: false, reason: "manual" });

  const [zones, ranges, truckZones, trucks, slots, blocks, slotRow, loadRows] = await Promise.all([
    supabase.from("delivery_zones").select("*").eq("organization_id", orgId),
    supabase.from("zone_postcode_ranges").select("*").eq("organization_id", orgId),
    supabase.from("truck_zones").select("*").eq("organization_id", orgId),
    supabase.from("trucks").select("*").eq("organization_id", orgId),
    supabase.from("delivery_slots").select("*").eq("organization_id", orgId),
    supabase.from("schedule_blocks").select("*").eq("organization_id", orgId).eq("block_date", order.delivery_date),
    supabase.from("delivery_slots").select("start_time").eq("id", order.slot_id).maybeSingle(),
    supabase
      .from("orders")
      .select("truck_id")
      .eq("organization_id", orgId)
      .eq("delivery_date", order.delivery_date)
      .in("status", ["confirmed", "ready"])
      .neq("assignment_source", "none")
      .neq("id", orderId),
  ]);

  if (zones.error || ranges.error || truckZones.error || trucks.error || slots.error || blocks.error || loadRows.error) {
    return err("internal", "Failed to load assignment context");
  }

  const loads: Record<string, number> = {};
  for (const row of loadRows.data ?? []) {
    loads[row.truck_id] = (loads[row.truck_id] ?? 0) + 1;
  }

  const ctx: AssignmentContext = {
    zones: zones.data ?? [],
    ranges: (ranges.data ?? []) as ZonePostcodeRange[],
    truckZones: truckZones.data ?? [],
    trucks: (trucks.data ?? []) as DispatchTruck[],
    slots: slots.data ?? [],
    blocks: blocks.data ?? [],
    loads,
  };

  const suggestion = suggestTruck(
    {
      postcode: order.postcode,
      delivery_date: order.delivery_date,
      slot_start_time: slotRow.data?.start_time ?? null,
    },
    ctx,
  );
  if (!suggestion.ok) return ok({ assigned: false, reason: suggestion.reason });

  const { error: rpcError } = await supabase.rpc("dispatch_assign_order", {
    p_order: orderId,
    p_truck: suggestion.truckId,
    p_source: "auto",
  });
  if (rpcError) return mapRpcError(rpcError.message);

  revalidatePath(`/${organizationSlug}/dispatch`);
  return ok({ assigned: true });
}

// ---------------------------------------------------------------------------
// Depart
// ---------------------------------------------------------------------------

const DepartInputSchema = z.object({
  truckId: z.string().uuid(),
  date: z.string().regex(DATE_REGEX),
});

export async function departTruck(
  organizationSlug: string,
  rawInput: unknown,
): Promise<ActionResult> {
  const guard = await guardDispatch(organizationSlug);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const parsed = DepartInputSchema.safeParse(rawInput);
  if (!parsed.success) return err("validation", "Invalid depart input");

  const supabase = await createSupabaseServerClient();
  const { data: run, error: runError } = await supabase
    .from("delivery_runs")
    .select("id")
    .eq("organization_id", orgId)
    .eq("truck_id", parsed.data.truckId)
    .eq("run_date", parsed.data.date)
    .maybeSingle();
  if (runError) return err("internal", runError.message);
  if (!run) return err("not_found", "No delivery run exists for this truck on this date.");

  const { error } = await supabase.rpc("set_run_status", {
    p_run: run.id,
    p_status: "departed",
  });
  if (error) {
    if (error.message.includes("invalid_transition")) {
      return err("conflict", "This run cannot depart from its current status.");
    }
    return mapRpcError(error.message);
  }

  revalidatePath(`/${organizationSlug}/dispatch`);
  revalidatePath(`/${organizationSlug}/runs`);
  return ok(undefined);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/logistics/tests/unit/dispatch-actions.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/logistics/server/dispatch-actions.ts src/features/logistics/tests/unit/dispatch-actions.test.ts
git commit -m "feat(logistics): dispatch board read, assign/unassign, auto-assign, depart"
```

---

### Task 9: Auto-assign on order confirm + postcode capture

**Files:**
- Modify: `src/features/orders/server/order-actions.ts` (`confirmOrder`, around line 196)
- Modify: `src/features/orders/types.ts` (`PlaceOrderSchema` gains optional postcode)
- Modify: `src/features/orders/server/portal-actions.ts` and `createManualOrder` in `order-actions.ts` (pass postcode through on insert if they insert directly; if order creation goes through the `place_order` RPC, add `p_postcode` is NOT needed — instead update the order row after RPC success)
- Test: extend `src/features/orders/tests/unit/order-actions.test.ts`

**Interfaces:**
- Consumes: `autoAssignOrder` from `@/features/logistics/server/dispatch-actions`

- [ ] **Step 1: Write the failing test**

Add to `src/features/orders/tests/unit/order-actions.test.ts` (reusing that file's existing mock helpers; also mock the logistics module at the top of the file, next to the existing `vi.mock` calls):

```ts
vi.mock("@/features/logistics/server/dispatch-actions", () => ({
  autoAssignOrder: vi.fn().mockResolvedValue({ ok: true, data: { assigned: true } }),
}));
```

```ts
import { autoAssignOrder } from "@/features/logistics/server/dispatch-actions";

describe("confirmOrder auto-assign", () => {
  it("fires autoAssignOrder after a successful confirm", async () => {
    const supabase = mockSupabaseFor({ role: "seller" });
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    const result = await confirmOrder({
      organizationSlug: "ayam-norliza-pilot",
      orderId: "5b1f5c1e-0000-4000-8000-000000000001",
      decisions: [{ itemId: "5b1f5c1e-0000-4000-8000-000000000002", available: true }],
    });

    expect(result.ok).toBe(true);
    expect(autoAssignOrder).toHaveBeenCalledWith(
      "ayam-norliza-pilot",
      "5b1f5c1e-0000-4000-8000-000000000001",
    );
  });

  it("does not fail the confirm when auto-assign errors", async () => {
    vi.mocked(autoAssignOrder).mockResolvedValueOnce({
      ok: false, code: "internal", message: "boom",
    });
    const supabase = mockSupabaseFor({ role: "seller" });
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    const result = await confirmOrder({
      organizationSlug: "ayam-norliza-pilot",
      orderId: "5b1f5c1e-0000-4000-8000-000000000001",
      decisions: [{ itemId: "5b1f5c1e-0000-4000-8000-000000000002", available: true }],
    });

    expect(result.ok).toBe(true);
  });
});
```

Adapt the `confirmOrder` argument shape to whatever `ConfirmOrderSchema` requires — the schema is in `src/features/orders/types.ts` (organizationSlug, orderId, decisions).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/orders/tests/unit/order-actions.test.ts`
Expected: new tests FAIL — `autoAssignOrder` not called.

- [ ] **Step 3: Wire auto-assign into `confirmOrder`**

In `src/features/orders/server/order-actions.ts`, import at the top:

```ts
import { autoAssignOrder } from "@/features/logistics/server/dispatch-actions";
```

In `confirmOrder`, after the `confirm_order` RPC succeeds and before the final `revalidatePath`/return, add:

```ts
  // Fire-and-forget suggestion: a failed auto-assign must never fail the
  // confirm — the ticket just lands in the dispatch pool instead.
  try {
    await autoAssignOrder(input.organizationSlug, input.orderId);
  } catch {
    // ignore
  }
```

- [ ] **Step 4: Capture postcode at order creation**

In `src/features/orders/types.ts`, add to `PlaceOrderSchema` after `address`:

```ts
  postcode: z.string().regex(/^\d{5}$/).optional(),
```

Then find where the order row is created (the `place_order` RPC call in `createManualOrder` at `order-actions.ts:169` and its portal twin in `portal-actions.ts`). The RPC signature does not accept postcode, so after a successful `place_order` RPC that returns the new order id, update the row:

```ts
  if (parsedInput.postcode) {
    await supabase.from("orders").update({ postcode: parsedInput.postcode }).eq("id", newOrderId);
  }
```

`place_order` returns the new order's `uuid` (verify in `supabase/migrations/20260810000002_order_pipeline_functions.sql`), so do this write-back in both `createManualOrder` and the portal order action. Then add the `postcode` input field to the two order forms that already collect `address` (buyer checkout form and manual order form): a 5-digit text input next to the address field, value passed through to the action input object as `postcode`. Orders placed without a postcode are valid — they land in the dispatch board's Unassigned pool for manual drag.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/features/orders/tests/unit/order-actions.test.ts`
Expected: PASS including the two new tests.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/orders src/features/logistics
git commit -m "feat(orders): capture postcode and auto-assign truck on confirm"
```

---

### Task 10: Dispatch board UI + route + sidebar

**Files:**
- Create: `src/features/logistics/components/dispatch-board.tsx`
- Create: `src/features/logistics/components/ticket-card.tsx`
- Create: `src/features/logistics/components/truck-card.tsx`
- Create: `src/app/(seller)/[organizationSlug]/dispatch/page.tsx`
- Modify: `src/features/dashboard/components/dashboard-shell-model.ts` (add Dispatch nav entry; logistics staff see it too)
- Modify: `src/features/dashboard/tests/unit/dashboard-shell-model.test.ts` (expected nav arrays)

**Interfaces:**
- Consumes: `buildBoardView`, `compatibleTruckIds` from `../lib/dispatch-board-model`; `resolveDispatchDrop` from `../lib/dispatch-rules`; `assignOrder`, `unassignOrder`, `departTruck`, `getDispatchBoard` from `../server/dispatch-actions`; dnd-kit (`DndContext`, `useDraggable`, `useDroppable`, `DragOverlay`, `PointerSensor`) exactly as `orders-board.tsx` uses them
- Produces: `<DispatchBoard organizationSlug initialDate initialData role />` client component

- [ ] **Step 1: Ticket card (`ticket-card.tsx`)**

```tsx
"use client";

import { useDraggable } from "@dnd-kit/core";
import { ORDER_STATUS_COLORS, ORDER_STATUS_LABELS } from "@/features/orders/types";
import type { DispatchTicket } from "../types";

export function TicketCard({
  ticket,
  disabled,
  overlay = false,
}: {
  ticket: DispatchTicket;
  disabled?: boolean;
  overlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: ticket.id,
    disabled,
  });

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      {...(overlay ? {} : { ...attributes, ...listeners })}
      className={[
        "rounded-md border bg-card p-2 text-sm shadow-sm",
        disabled ? "opacity-60" : "cursor-grab active:cursor-grabbing",
        isDragging && !overlay ? "opacity-40" : "",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium truncate">{ticket.customer?.name ?? "Customer"}</span>
        <span className={`rounded px-1.5 py-0.5 text-xs ${ORDER_STATUS_COLORS[ticket.status]}`}>
          {ORDER_STATUS_LABELS[ticket.status]}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {ticket.zone?.name ? <span className="rounded bg-muted px-1.5 py-0.5">{ticket.zone.name}</span> : null}
        <span>{ticket.postcode ?? "no postcode"}</span>
        {ticket.assignment_source !== "none" ? (
          <span className="rounded bg-muted px-1.5 py-0.5">
            {ticket.assignment_source === "auto" ? "auto" : "manual"}
          </span>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Truck card (`truck-card.tsx`)**

```tsx
"use client";

import { useDroppable } from "@dnd-kit/core";
import type { BoardTruck } from "../lib/dispatch-board-model";
import { TicketCard } from "./ticket-card";

export function TruckCard({
  boardTruck,
  highlight,
  dim,
  departing,
  onDepart,
  canDepart,
}: {
  boardTruck: BoardTruck;
  highlight: boolean;
  dim: boolean;
  departing: boolean;
  onDepart: () => void;
  canDepart: boolean;
}) {
  const { truck, tickets, load, cap, departed } = boardTruck;
  const { setNodeRef, isOver } = useDroppable({ id: `truck:${truck.id}`, disabled: departed });

  if (departed && !departing) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground">
        <span className="font-medium">{truck.name}</span> — on the road with {load} order{load === 1 ? "" : "s"}
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={[
        "rounded-lg border bg-background p-3 transition-all duration-300 motion-reduce:transition-none",
        highlight ? "border-green-500 ring-2 ring-green-500/30" : "",
        dim ? "opacity-50" : "",
        isOver ? "bg-accent" : "",
        departing ? "translate-x-full opacity-0" : "",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="font-semibold">{truck.name}</span>
          <span className="ml-2 text-xs text-muted-foreground">{truck.code}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {load}
            {cap !== null ? `/${cap}` : ""}
          </span>
          <button
            type="button"
            onClick={onDepart}
            disabled={!canDepart}
            className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-40"
          >
            Depart
          </button>
        </div>
      </div>
      <div className="mt-2 flex min-h-16 flex-col gap-2">
        {tickets.map((t) => (
          <TicketCard key={t.id} ticket={t} />
        ))}
        {tickets.length === 0 ? (
          <div className="rounded border border-dashed p-2 text-center text-xs text-muted-foreground">
            Drop orders here
          </div>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Board (`dispatch-board.tsx`)**

```tsx
"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { DispatchBoardData, DispatchTicket } from "../types";
import { buildBoardView, compatibleTruckIds } from "../lib/dispatch-board-model";
import { resolveDispatchDrop, type DispatchDropTarget } from "../lib/dispatch-rules";
import { assignOrder, departTruck, getDispatchBoard, unassignOrder } from "../server/dispatch-actions";
import { TicketCard } from "./ticket-card";
import { TruckCard } from "./truck-card";

function PoolColumn({ tickets }: { tickets: DispatchTicket[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: "pool" });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col gap-2 rounded-lg border p-3 ${isOver ? "bg-accent" : "bg-muted/30"}`}
    >
      <h2 className="text-sm font-semibold">Order pool</h2>
      {tickets.map((t) => (
        <TicketCard key={t.id} ticket={t} />
      ))}
      {tickets.length === 0 ? (
        <p className="text-xs text-muted-foreground">No unassigned orders for this date.</p>
      ) : null}
    </div>
  );
}

export function DispatchBoard({
  organizationSlug,
  initialDate,
  initialData,
}: {
  organizationSlug: string;
  initialDate: string;
  initialData: DispatchBoardData;
}) {
  const [date, setDate] = useState(initialDate);
  const [data, setData] = useState(initialData);
  const [activeTicket, setActiveTicket] = useState<DispatchTicket | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [override, setOverride] = useState<{ orderId: string; truckId: string; truckName: string } | null>(null);
  const [departConfirm, setDepartConfirm] = useState<{ truckId: string; notReady: number } | null>(null);
  const [departingTruckId, setDepartingTruckId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const view = useMemo(() => buildBoardView(data, date), [data, date]);
  const compatible = useMemo(
    () => (activeTicket ? compatibleTruckIds(activeTicket, data) : null),
    [activeTicket, data],
  );

  const refetch = useCallback(
    (forDate: string) => {
      startTransition(async () => {
        const result = await getDispatchBoard(organizationSlug, forDate);
        if (result.ok) setData(result.data);
        else setToast(result.message);
      });
    },
    [organizationSlug],
  );

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  };

  const runAction = (action: Promise<{ ok: boolean; message?: string }>) => {
    startTransition(async () => {
      const result = await action;
      if (!result.ok) showToast(result.message ?? "Action failed");
      refetch(date);
    });
  };

  const handleDragStart = (event: DragStartEvent) => {
    const ticket = data.orders.find((o) => o.id === event.active.id);
    setActiveTicket(ticket ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const ticket = activeTicket;
    setActiveTicket(null);
    if (!ticket || !event.over) return;

    const overId = String(event.over.id);
    let target: DispatchDropTarget;
    if (overId === "pool") {
      target = { type: "pool" };
    } else if (overId.startsWith("truck:")) {
      const truckId = overId.slice("truck:".length);
      const boardTruck = view.bays.flatMap((b) => b.trucks).find((t) => t.truck.id === truckId);
      if (!boardTruck) return;
      target = {
        type: "truck",
        truckId,
        compatible: compatible?.has(truckId) ?? false,
        atCapacity: boardTruck.cap !== null && boardTruck.load >= boardTruck.cap,
        departed: boardTruck.departed,
      };
    } else {
      return;
    }

    const assignedTruckId = ticket.assignment_source === "none" ? null : ticket.truck_id;
    const runStatus = data.runs.find((r) => r.id === ticket.run_id)?.status ?? null;
    const resolution = resolveDispatchDrop(
      { status: ticket.status, assignedTruckId, runStatus },
      target,
    );

    if (resolution.kind === "noop") return;
    if (resolution.kind === "blocked") {
      showToast(resolution.reason);
      return;
    }
    if (resolution.kind === "unassign") {
      runAction(unassignOrder(organizationSlug, { orderId: ticket.id }));
      return;
    }
    if (resolution.kind === "override") {
      const truck = data.trucks.find((t) => t.id === resolution.truckId);
      setOverride({ orderId: ticket.id, truckId: resolution.truckId, truckName: truck?.name ?? "this truck" });
      return;
    }
    runAction(assignOrder(organizationSlug, { orderId: ticket.id, truckId: resolution.truckId }));
  };

  const requestDepart = (truckId: string) => {
    const boardTruck = view.bays.flatMap((b) => b.trucks).find((t) => t.truck.id === truckId);
    if (!boardTruck) return;
    const notReady = boardTruck.tickets.filter((t) => t.status !== "ready").length;
    if (notReady > 0) {
      setDepartConfirm({ truckId, notReady });
    } else {
      doDepart(truckId);
    }
  };

  const doDepart = (truckId: string) => {
    setDepartConfirm(null);
    setDepartingTruckId(truckId);
    startTransition(async () => {
      const result = await departTruck(organizationSlug, { truckId, date });
      if (!result.ok) {
        setDepartingTruckId(null);
        showToast(result.message);
        return;
      }
      // Let the slide-out animation play before the board re-renders the
      // truck as departed. Matches the 300ms transition on TruckCard.
      setTimeout(() => {
        setDepartingTruckId(null);
        refetch(date);
      }, 350);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Dispatch</h1>
        <input
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            refetch(e.target.value);
          }}
          className="rounded border px-2 py-1 text-sm"
        />
        {data.facility ? (
          <span className="text-sm text-muted-foreground">
            {data.facility.name} — {data.facility.address_line}, {data.facility.postcode}
          </span>
        ) : null}
      </div>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex items-start gap-4 overflow-x-auto pb-4">
          <PoolColumn tickets={view.pool} />
          {view.bays.map(({ bay, trucks }) => (
            <div key={bay.id} className="flex w-80 shrink-0 flex-col gap-3 rounded-lg border bg-muted/20 p-3">
              <h2 className="text-sm font-semibold">{bay.name}</h2>
              {trucks.map((bt) => (
                <TruckCard
                  key={bt.truck.id}
                  boardTruck={bt}
                  highlight={compatible !== null && compatible.has(bt.truck.id) && !bt.departed}
                  dim={compatible !== null && !compatible.has(bt.truck.id)}
                  departing={departingTruckId === bt.truck.id}
                  onDepart={() => requestDepart(bt.truck.id)}
                  canDepart={!bt.departed && bt.tickets.some((t) => t.status === "ready")}
                />
              ))}
              {trucks.length === 0 ? (
                <p className="text-xs text-muted-foreground">No trucks in this bay.</p>
              ) : null}
            </div>
          ))}
        </div>
        <DragOverlay>{activeTicket ? <TicketCard ticket={activeTicket} overlay /> : null}</DragOverlay>
      </DndContext>

      {toast ? (
        <div className="fixed bottom-4 right-4 rounded-md bg-destructive px-4 py-2 text-sm text-destructive-foreground shadow-lg">
          {toast}
        </div>
      ) : null}

      {override ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-96 rounded-lg bg-background p-4 shadow-xl">
            <h3 className="font-semibold">Override coverage?</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {override.truckName} does not cover this order&apos;s zone. Assign anyway?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={() => setOverride(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                onClick={() => {
                  runAction(assignOrder(organizationSlug, { orderId: override.orderId, truckId: override.truckId }));
                  setOverride(null);
                }}
              >
                Override
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {departConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-96 rounded-lg bg-background p-4 shadow-xl">
            <h3 className="font-semibold">Depart without {departConfirm.notReady} unready order{departConfirm.notReady === 1 ? "" : "s"}?</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Orders that are not ready stay behind and return to the pool for a later run.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={() => setDepartConfirm(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                onClick={() => doDepart(departConfirm.truckId)}
              >
                Depart
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

Note on "orders that are not ready stay behind": `set_run_status` only sweeps `ready` orders on completion; confirmed orders keep their run_id but the run has departed, so the board blocks further moves. This matches the RPC's semantics; the dialog copy tells staff what actually happens. If staff want the leftover confirmed orders moved to another truck later, they first get weighed (ready) and dispatch again the next day — acceptable for v1 and consistent with `dispatch_assign_order`'s `run_departed` guard. Verify this behavior in the manual test (Task 12) and adjust dialog copy if the observed behavior differs.

- [ ] **Step 4: Route page `src/app/(seller)/[organizationSlug]/dispatch/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { OrderPermissionError, requireOrgRole } from "@/features/orders/server/guards";
import { DISPATCH_ROLES } from "@/features/logistics/lib/roles";
import { getDispatchBoard } from "@/features/logistics/server/dispatch-actions";
import { DispatchBoard } from "@/features/logistics/components/dispatch-board";

function todayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default async function DispatchPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;

  try {
    await requireOrgRole(organizationSlug, DISPATCH_ROLES);
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      redirect(`/${organizationSlug}`);
    }
    throw error;
  }

  const date = todayIsoDate();
  const result = await getDispatchBoard(organizationSlug, date);
  if (!result.ok) {
    throw new Error(result.message);
  }

  return (
    <DispatchBoard organizationSlug={organizationSlug} initialDate={date} initialData={result.data} />
  );
}
```

Check sibling pages (e.g. `src/app/(seller)/[organizationSlug]/delivery/page.tsx`) for layout-wrapper components they render inside; wrap `DispatchBoard` the same way if the route group's layout does not already provide the shell.

- [ ] **Step 5: Sidebar entries**

In `src/features/dashboard/components/dashboard-shell-model.ts`:

1. Add to the Sales group after `{ title: "Delivery setup", segment: "delivery" }`:

```ts
      { title: "Dispatch", segment: "dispatch" },
```

2. In the staff-only branch, give the `logistics` role the dispatch link too. Replace the branch body with:

```ts
  if (role && (STAFF_ONLY_ROLES as readonly string[]).includes(role)) {
    const tasksHref = `/${organizationSlug}/tasks`;
    const items = [
      { title: "Warehouse tasks", href: tasksHref, isActive: isRouteActive(pathname, tasksHref) },
    ];
    if (role === "logistics") {
      const dispatchHref = `/${organizationSlug}/dispatch`;
      items.push({ title: "Dispatch", href: dispatchHref, isActive: isRouteActive(pathname, dispatchHref) });
    }
    return [{ title: "Warehouse", isActive: items.some((item) => item.isActive), items }];
  }
```

3. Update `src/features/dashboard/tests/unit/dashboard-shell-model.test.ts`: run it, and fix every failing expectation by adding the new "Dispatch" item where the test asserts the Sales group or the logistics staff nav.

- [ ] **Step 6: Verify**

Run: `npx vitest run src/features/dashboard/tests/unit/dashboard-shell-model.test.ts`
Expected: PASS after expectation updates.

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/logistics/components "src/app/(seller)/[organizationSlug]/dispatch" src/features/dashboard
git commit -m "feat(logistics): dispatch board UI with drag-drop and departure animation"
```

---

### Task 11: Delivery admin — Factory, Bays, Zone postcodes

**Files:**
- Create: `src/features/logistics/components/facility-panel.tsx`
- Create: `src/features/logistics/components/bays-panel.tsx`
- Create: `src/features/logistics/components/postcode-ranges-panel.tsx`
- Modify: `src/app/(seller)/[organizationSlug]/delivery/page.tsx` (load logistics setup + role, pass down)
- Modify: `src/app/(seller)/[organizationSlug]/delivery/delivery-client.tsx` (render the three panels)

**Interfaces:**
- Consumes: `getLogisticsSetup`, `updateFacility`, `createBay`, `updateBay`, `deleteBay`, `setTruckBay`, `addPostcodeRange`, `deletePostcodeRange` from `../server/facility-actions`; `LogisticsSetup` type

- [ ] **Step 1: Facility panel (`facility-panel.tsx`)**

```tsx
"use client";

import { useState, useTransition } from "react";
import type { Facility } from "../types";
import { updateFacility } from "../server/facility-actions";

export function FacilityPanel({
  organizationSlug,
  facility,
  canEdit,
}: {
  organizationSlug: string;
  facility: Facility | null;
  canEdit: boolean;
}) {
  const [form, setForm] = useState({
    name: facility?.name ?? "",
    addressLine: facility?.address_line ?? "",
    postcode: facility?.postcode ?? "",
    state: facility?.state ?? "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!facility) {
    return <p className="text-sm text-muted-foreground">No facility configured yet.</p>;
  }

  const save = () => {
    startTransition(async () => {
      const result = await updateFacility(organizationSlug, facility.id, form);
      setMessage(result.ok ? "Saved." : result.message);
    });
  };

  const field = (label: string, key: keyof typeof form) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <input
        value={form[key]}
        disabled={!canEdit}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className="rounded border px-2 py-1 disabled:bg-muted"
      />
    </label>
  );

  return (
    <div className="flex max-w-lg flex-col gap-3">
      {!canEdit ? (
        <p className="text-xs text-muted-foreground">
          Only owners and admins can edit the factory location.
        </p>
      ) : null}
      {field("Name", "name")}
      {field("Address", "addressLine")}
      <div className="grid grid-cols-2 gap-3">
        {field("Postcode", "postcode")}
        {field("State", "state")}
      </div>
      {canEdit ? (
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="self-start rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
        >
          Save factory
        </button>
      ) : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
    </div>
  );
}
```

- [ ] **Step 2: Bays panel (`bays-panel.tsx`)**

```tsx
"use client";

import { useState, useTransition } from "react";
import type { Truck } from "@/features/orders/types";
import type { Bay } from "../types";
import { createBay, deleteBay, setTruckBay } from "../server/facility-actions";

export function BaysPanel({
  organizationSlug,
  facilityId,
  bays,
  trucks,
}: {
  organizationSlug: string;
  facilityId: string | null;
  bays: Bay[];
  trucks: (Truck & { bay_id: string | null })[];
}) {
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (action: Promise<{ ok: boolean; message?: string }>) => {
    startTransition(async () => {
      const result = await action;
      setMessage(result.ok ? null : (result.message ?? "Action failed"));
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {facilityId ? (
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">New bay name</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="rounded border px-2 py-1"
              placeholder="Bay 3"
            />
          </label>
          <button
            type="button"
            disabled={pending || newName.trim() === ""}
            onClick={() => {
              run(
                createBay(organizationSlug, {
                  facilityId,
                  name: newName.trim(),
                  position: bays.length + 1,
                }),
              );
              setNewName("");
            }}
            className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
          >
            Add bay
          </button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Configure the factory first.</p>
      )}

      <ul className="flex flex-col gap-2">
        {bays.map((bay) => (
          <li key={bay.id} className="flex items-center justify-between rounded border p-2 text-sm">
            <span className="font-medium">{bay.name}</span>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(deleteBay(organizationSlug, bay.id))}
              className="text-xs text-destructive"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Truck bay assignment</h3>
        <ul className="flex flex-col gap-2">
          {trucks.map((truck) => (
            <li key={truck.id} className="flex items-center justify-between rounded border p-2 text-sm">
              <span>
                {truck.name} <span className="text-xs text-muted-foreground">{truck.code}</span>
              </span>
              <select
                value={truck.bay_id ?? ""}
                disabled={pending}
                onChange={(e) => run(setTruckBay(organizationSlug, truck.id, e.target.value || null))}
                className="rounded border px-2 py-1 text-sm"
              >
                <option value="">No bay</option>
                {bays.map((bay) => (
                  <option key={bay.id} value={bay.id}>
                    {bay.name}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      </div>
      {message ? <p className="text-sm text-destructive">{message}</p> : null}
    </div>
  );
}
```

- [ ] **Step 3: Postcode ranges panel (`postcode-ranges-panel.tsx`)**

```tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import type { DeliveryZone } from "@/features/orders/types";
import type { ZonePostcodeRange } from "../types";
import { addPostcodeRange, deletePostcodeRange } from "../server/facility-actions";

/** Cross-zone overlaps: pairs of ranges in different zones sharing postcodes. */
function findOverlaps(ranges: ZonePostcodeRange[]): Array<[ZonePostcodeRange, ZonePostcodeRange]> {
  const overlaps: Array<[ZonePostcodeRange, ZonePostcodeRange]> = [];
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      const a = ranges[i];
      const b = ranges[j];
      if (a.zone_id !== b.zone_id && a.postcode_start <= b.postcode_end && b.postcode_start <= a.postcode_end) {
        overlaps.push([a, b]);
      }
    }
  }
  return overlaps;
}

export function PostcodeRangesPanel({
  organizationSlug,
  zones,
  ranges,
}: {
  organizationSlug: string;
  zones: DeliveryZone[];
  ranges: ZonePostcodeRange[];
}) {
  const [form, setForm] = useState({ zoneId: zones[0]?.id ?? "", postcodeStart: "", postcodeEnd: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const zoneName = (id: string) => zones.find((z) => z.id === id)?.name ?? "?";
  const overlaps = useMemo(() => findOverlaps(ranges), [ranges]);

  const run = (action: Promise<{ ok: boolean; message?: string }>) => {
    startTransition(async () => {
      const result = await action;
      setMessage(result.ok ? null : (result.message ?? "Action failed"));
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {overlaps.length > 0 ? (
        <div className="rounded border border-yellow-400 bg-yellow-50 p-2 text-xs text-yellow-900">
          Overlapping coverage: {overlaps
            .map(([a, b]) => `${zoneName(a.zone_id)} & ${zoneName(b.zone_id)} (${a.postcode_start}-${a.postcode_end} / ${b.postcode_start}-${b.postcode_end})`)
            .join("; ")}. First match by zone name wins.
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Zone</span>
          <select
            value={form.zoneId}
            onChange={(e) => setForm((f) => ({ ...f, zoneId: e.target.value }))}
            className="rounded border px-2 py-1"
          >
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">From</span>
          <input
            value={form.postcodeStart}
            onChange={(e) => setForm((f) => ({ ...f, postcodeStart: e.target.value }))}
            className="w-24 rounded border px-2 py-1"
            placeholder="82000"
            maxLength={5}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">To</span>
          <input
            value={form.postcodeEnd}
            onChange={(e) => setForm((f) => ({ ...f, postcodeEnd: e.target.value }))}
            className="w-24 rounded border px-2 py-1"
            placeholder="82300"
            maxLength={5}
          />
        </label>
        <button
          type="button"
          disabled={pending || form.zoneId === ""}
          onClick={() => run(addPostcodeRange(organizationSlug, form))}
          className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
        >
          Add range
        </button>
      </div>

      <ul className="flex flex-col gap-2">
        {ranges.map((r) => (
          <li key={r.id} className="flex items-center justify-between rounded border p-2 text-sm">
            <span>
              <span className="font-medium">{zoneName(r.zone_id)}</span>{" "}
              {r.postcode_start} – {r.postcode_end}
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(deletePostcodeRange(organizationSlug, r.id))}
              className="text-xs text-destructive"
            >
              Delete
            </button>
          </li>
        ))}
        {ranges.length === 0 ? (
          <p className="text-sm text-muted-foreground">No postcode ranges yet — orders will land in the Unassigned pool.</p>
        ) : null}
      </ul>
      {message ? <p className="text-sm text-destructive">{message}</p> : null}
    </div>
  );
}
```

- [ ] **Step 4: Wire into the delivery admin page**

1. `src/app/(seller)/[organizationSlug]/delivery/page.tsx`: also call `getLogisticsSetup(organizationSlug)` (import from `@/features/logistics/server/facility-actions`), capture the caller's role from `requireOrgRole`'s return value, and pass `logisticsSetup={logistics.data}` and `role={ctx.role}` to `DeliveryClient`:

```tsx
  const ctx = await (async () => {
    try {
      return await requireOrgRole(organizationSlug, MANAGER_ROLES);
    } catch (error) {
      if (error instanceof OrderPermissionError) {
        redirect(`/${organizationSlug}/tasks`);
      }
      throw error;
    }
  })();

  const [result, logistics] = await Promise.all([
    getDeliverySetup(organizationSlug),
    getLogisticsSetup(organizationSlug),
  ]);
  if (!result.ok) throw new Error(result.message);
  if (!logistics.ok) throw new Error(logistics.message);

  return (
    <DeliveryClient
      organizationSlug={organizationSlug}
      initialSetup={result.data}
      logisticsSetup={logistics.data}
      role={ctx.role}
    />
  );
```

2. `delivery-client.tsx`: read the file first; it renders the existing zones/trucks/slots/blocks sections (likely as tabs or stacked sections). Add three new sections/tabs following the exact same structural pattern the file already uses, titled **Factory**, **Bays**, **Zone postcodes**, rendering:

```tsx
<FacilityPanel
  organizationSlug={organizationSlug}
  facility={logisticsSetup.facility}
  canEdit={role === "owner" || role === "org_admin"}
/>
<BaysPanel
  organizationSlug={organizationSlug}
  facilityId={logisticsSetup.facility?.id ?? null}
  bays={logisticsSetup.bays}
  trucks={initialSetup.trucks as (Truck & { bay_id: string | null })[]}
/>
<PostcodeRangesPanel
  organizationSlug={organizationSlug}
  zones={initialSetup.zones}
  ranges={logisticsSetup.ranges}
/>
```

Extend the `DeliveryClient` props type with `logisticsSetup: LogisticsSetup; role: string`.

Note: `getDeliverySetup` selects `*` from trucks, so `bay_id` is already present at runtime after the Task 1 migration; the cast makes it visible to TypeScript. If `Truck` in `src/features/orders/types.ts` is easier to extend directly (add `bay_id: string | null`), do that instead of casting and drop `DispatchTruck` in favor of the extended `Truck` everywhere — pick ONE approach and apply it consistently; extending `Truck` is preferred if the typecheck stays green.

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/logistics/components "src/app/(seller)/[organizationSlug]/delivery"
git commit -m "feat(logistics): factory, bays, and postcode-range admin panels"
```

---

### Task 12: Full verification + manual browser test

**Files:** none (verification only)

- [ ] **Step 1: Full automated pass**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all PASS, zero failures.

Run: `npm run db:reset`
Expected: clean apply including seed data.

- [ ] **Step 2: Manual verification in the browser (dev server + preview)**

Start the dev server via the launch config (or `npm run dev`) and walk through:

1. `/[org]/delivery` — Factory tab shows the seeded Kilang Ayam address; editable as owner. Bays tab: create "Bay 1" and "Bay 2"; assign trucks to bays. Zone postcodes: add `82000–82300` to a zone; add an overlapping range to another zone and confirm the warning banner.
2. `/[org]/dispatch` — board shows pool + bays + trucks with load counts.
3. Confirm a pending order (orders kanban) with a postcode-covered address → ticket appears on the suggested truck with the `auto` badge.
4. Drag the ticket to another truck covering the zone → assigns, badge flips to `manual`. Drag start highlights compatible trucks, dims the rest.
5. Drag onto a non-covering truck → override dialog; confirm → assigned.
6. Drag back to the pool → unassigned.
7. Complete the weigh task so the order is `ready`, press Depart → truck card slides out, "On the road" summary appears; the run shows departed on `/[org]/runs`.
8. Verify a departed truck's tickets can no longer be dragged (toast).

- [ ] **Step 3: Fix anything found, re-run step 1, commit fixes**

```bash
git add -A
git commit -m "fix(logistics): dispatch board verification fixes"
```

(Skip the commit if nothing was found.)
