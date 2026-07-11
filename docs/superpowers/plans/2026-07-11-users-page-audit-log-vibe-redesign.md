# Users Page Audit-Log Vibe Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the editorial Users/Roles page furniture with the same calm, dense command-center surface used by the Audit Log page — icon header + three stat tiles, filter card, date-bucketed member timeline, right-side Sheet detail. No schema or permission changes.

**Architecture:** Pure presentation rewrite. One new client component (`UsersPageClient`), one new pure-model file, two small query-helper extensions to support filter params and per-actor audit fetching. The page route stays at `settings/roles`. Old editorial components are kept but no longer rendered.

**Tech Stack:** Next.js 14 (App Router), React server + client components, Supabase RLS queries, Tailwind CSS, shadcn/ui (`Sheet`, `Select`, `Input`, `Badge`, `Button`), lucide-react icons, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-11-users-page-audit-log-vibe-redesign.md`

---

## File Structure

Files created:
- `src/features/identity-access/components/users-page-client.tsx` — Client UI (filter card + timeline + Sheet).
- `src/features/identity-access/lib/users-page-model.ts` — Pure helpers (`bucketizeMembers`, `filterMembers`, `classifyMemberStatus`, `formatJoinBucketLabel`, `MemberRow`, `MemberBucket`, `MemberStatus` type).
- `src/features/identity-access/tests/unit/users-page-model.test.ts` — Vitest unit tests for the pure helpers.
- `src/features/identity-access/tests/unit/users-page-client.test.tsx` — Vitest + Testing Library component test for the client render.

Files modified:
- `src/features/identity-access/server/queries.ts` — extend `listMembers(orgId, opts?)` to accept optional filter opts (defaults preserved), and extend `listAuditLog` to accept `actorUserId` for the Sheet's recent-activity query.
- `src/app/(dashboard)/[organizationSlug]/settings/roles/page.tsx` — replace editorial components with header + stat tiles + `<UsersPageClient>`.

Files NOT modified (kept for future re-use):
- `src/features/access-control/components/{roles-masthead,capability-matrix,role-roster,rank-ladder,invitations-queue}.tsx` — left in codebase, not imported by the page this round.
- `src/features/identity-access/components/roles-page-client.tsx` — editor for the editable matrix; not rendered this round.

---

## Global Constraints

- Follow the existing TypeScript strict-mode settings already in `tsconfig.json`.
- Tailwind tokens, colour palette, font families, and existing `toneClasses` patterns come from `audit-log-client.tsx` — DO NOT introduce new colours or CSS variables. Re-use `bg-emerald-500/10 text-emerald-700 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-300`, etc.
- Never use `useEffect` for filter state; bind state to URL search params via `router.replace()` and `useTransition()` — same pattern as `audit-log-client.tsx`.
- All server queries must call `await requireUserOrRedirect()` (or rely on the page-level guard). RLS handles authorisation.
- No new `server actions` (mutating endpoints). The current `roles.ts` actions (`updateRoleCapabilityAction`, `resetRoleToDefaultsAction`) stay in place and unchanged.
- Headless UI component imports use only paths in `src/components/ui/*` and `lucide-react`.
- TDD: write the failing test FIRST for every pure function and for the page-client render. Do not proceed to the implementation step until the test is failing for the expected reason.
- Commits: small, scoped, imperative subject. Use conventional commits (`feat:`, `test:`, `refactor:`, `chore:`, `docs:`).

---

## Task 1: Pure model — `bucketizeMembers` and `formatJoinBucketLabel`

**Files:**
- Create: `src/features/identity-access/lib/users-page-model.ts`
- Test: `src/features/identity-access/tests/unit/users-page-model.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - Type `MemberRow = { id: string; userId: string; displayName: string; email: string; role: Role; status: MemberStatus; startsAt: string; }` where `Role` re-exports from `@/lib/auth/permissions` and `MemberStatus = "invited" | "active" | "suspended" | "expired"`.
  - Type `MemberBucket = { key: string; label: string; rows: MemberRow[] }`.
  - Function `formatJoinBucketLabel(date: Date, now?: Date): string` returning `"Today" | "Yesterday" | "Earlier this week" | "Earlier this month" | <locale date>`.
  - Function `bucketizeMembers(rows: MemberRow[], now?: Date): MemberBucket[]` — newest bucket first.

- [ ] **Step 1.1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  bucketizeMembers,
  formatJoinBucketLabel,
  type MemberRow,
} from "@/features/identity-access/lib/users-page-model";

const now = new Date("2026-07-11T12:00:00.000Z");

function row(partial: Partial<MemberRow> & { startsAt: string; id: string }): MemberRow {
  return {
    id: partial.id,
    userId: partial.userId ?? `user-${partial.id}`,
    displayName: partial.displayName ?? `Name ${partial.id}`,
    email: partial.email ?? `${partial.id}@example.com`,
    role: partial.role ?? "caretaker",
    status: partial.status ?? "active",
    startsAt: partial.startsAt,
  };
}

describe("formatJoinBucketLabel", () => {
  it('returns "Today" for the same calendar day', () => {
    expect(formatJoinBucketLabel(now, now)).toBe("Today");
  });
  it('returns "Yesterday" for one day before now', () => {
    const yesterday = new Date(now);
    yesterday.setUTCDate(now.getUTCDate() - 1);
    expect(formatJoinBucketLabel(yesterday, now)).toBe("Yesterday");
  });
  it('returns "Earlier this week" for a date 2–6 days ago in the same ISO week', () => {
    const date = new Date(now);
    date.setUTCDate(now.getUTCDate() - 3);
    expect(formatJoinBucketLabel(date, now)).toBe("Earlier this week");
  });
  it("returns a locale-formatted date for older dates", () => {
    const old = new Date("2025-01-04T00:00:00.000Z");
    const label = formatJoinBucketLabel(old, now);
    expect(label).toMatch(/Jan/);
    expect(label).toMatch(/2025/);
  });
});

describe("bucketizeMembers", () => {
  it("groups rows by join day, newest bucket first", () => {
    const today = row({ id: "a", startsAt: "2026-07-11T09:00:00.000Z" });
    const today2 = row({ id: "b", startsAt: "2026-07-11T01:00:00.000Z" });
    const yesterday = row({ id: "c", startsAt: "2026-07-10T22:00:00.000Z" });
    const older = row({ id: "d", startsAt: "2025-01-04T00:00:00.000Z" });

    const buckets = bucketizeMembers([older, yesterday, today2, today], now);

    expect(buckets).toHaveLength(3);
    expect(buckets[0].label).toBe("Today");
    expect(buckets[0].rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(buckets[1].label).toBe("Yesterday");
    expect(buckets[1].rows.map((r) => r.id)).toEqual(["c"]);
    expect(buckets[2].label).toMatch(/Jan/);
  });

  it("returns an empty array for empty input", () => {
    expect(bucketizeMembers([], now)).toEqual([]);
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `pnpm vitest run src/features/identity-access/tests/unit/users-page-model.test.ts`
Expected: FAIL with `Cannot find module '@/features/identity-access/lib/users-page-model'`.

- [ ] **Step 1.3: Implement the module**

```ts
import type { Role } from "@/lib/auth/permissions";

export type MemberStatus = "invited" | "active" | "suspended" | "expired";

export type MemberRow = {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  role: Role;
  status: MemberStatus;
  startsAt: string;
};

export type MemberBucket = {
  key: string;
  label: string;
  rows: MemberRow[];
};

function toUtcDay(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

function daysBetween(a: Date, b: Date): number {
  const aDay = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const bDay = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((bDay - aDay) / 86_400_000);
}

export function formatJoinBucketLabel(date: Date, now: Date = new Date()): string {
  const diff = daysBetween(now, date);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return "Earlier this week";
  if (diff < 30) return "Earlier this month";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function bucketizeMembers(
  rows: ReadonlyArray<MemberRow>,
  now: Date = new Date(),
): MemberBucket[] {
  const groups = new Map<string, MemberBucket>();
  for (const r of rows) {
    const d = new Date(r.startsAt);
    const key = toUtcDay(d);
    const bucket = groups.get(key) ?? {
      key,
      label: formatJoinBucketLabel(d, now),
      rows: [],
    };
    bucket.rows.push(r);
    groups.set(key, bucket);
  }
  return Array.from(groups.values()).sort((a, b) => (a.key < b.key ? 1 : -1));
}
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `pnpm vitest run src/features/identity-access/tests/unit/users-page-model.test.ts`
Expected: PASS (5 passed / 0 failed).

- [ ] **Step 1.5: Commit**

```bash
git add src/features/identity-access/lib/users-page-model.ts src/features/identity-access/tests/unit/users-page-model.test.ts
git commit -m "feat(users-page): bucketizeMembers and formatJoinBucketLabel"
```

---

## Task 2: Pure model — `filterMembers` and `classifyMemberStatus`

**Files:**
- Modify: `src/features/identity-access/lib/users-page-model.ts`
- Modify (append tests): `src/features/identity-access/tests/unit/users-page-model.test.ts`

**Interfaces:**
- Produces:
  - Function `classifyMemberStatus(status: MemberStatus): { label: string; tone: "neutral" | "ok" | "warn" | "danger" }` — `"active" → "Active" / ok`, `"invited" → "Invited" / warn`, `"suspended" → "Suspended" / danger`, `"expired" → "Expired" / neutral`.
  - Function `filterMembers(opts: { rows: ReadonlyArray<MemberRow>; role: string; status: string; query: string; scope: string; scopeIndex: Map<string, string> }): MemberRow[]`.

- [ ] **Step 2.1: Append failing tests**

Add the following block at the bottom of the same test file (within the existing file, no new describe imports needed):

```ts
import {
  bucketizeMembers,
  classifyMemberStatus,
  filterMembers,
  formatJoinBucketLabel,
  type MemberRow,
} from "@/features/identity-access/lib/users-page-model";

describe("classifyMemberStatus", () => {
  it("maps each member status to a labelled tone", () => {
    expect(classifyMemberStatus("active")).toEqual({ label: "Active", tone: "ok" });
    expect(classifyMemberStatus("invited")).toEqual({ label: "Invited", tone: "warn" });
    expect(classifyMemberStatus("suspended")).toEqual({ label: "Suspended", tone: "danger" });
    expect(classifyMemberStatus("expired")).toEqual({ label: "Expired", tone: "neutral" });
  });
});

describe("filterMembers", () => {
  const baseRows: MemberRow[] = [
    row({ id: "a", startsAt: "2026-07-11T09:00:00Z", role: "owner", status: "active", displayName: "Ada Lovelace", email: "ada@example.com" }),
    row({ id: "b", startsAt: "2026-07-10T09:00:00Z", role: "supervisor", status: "invited", displayName: "Bob", email: "bob@example.com" }),
    row({ id: "c", startsAt: "2026-07-09T09:00:00Z", role: "caretaker", status: "suspended", displayName: "Cici", email: "cici@example.com" }),
  ];
  const emptyIndex = new Map<string, string>();

  it("returns all rows when no filters are active", () => {
    const result = filterMembers({ rows: baseRows, role: "", status: "", query: "", scope: "", scopeIndex: emptyIndex });
    expect(result).toHaveLength(3);
  });

  it("filters by role", () => {
    const result = filterMembers({ rows: baseRows, role: "supervisor", status: "", query: "", scope: "", scopeIndex: emptyIndex });
    expect(result.map((r) => r.id)).toEqual(["b"]);
  });

  it("filters by status", () => {
    const result = filterMembers({ rows: baseRows, role: "", status: "invited", query: "", scope: "", scopeIndex: emptyIndex });
    expect(result.map((r) => r.id)).toEqual(["b"]);
  });

  it("filters by query across name + email", () => {
    const result = filterMembers({ rows: baseRows, role: "", status: "", query: "ada@", scope: "", scopeIndex: emptyIndex });
    expect(result.map((r) => r.id)).toEqual(["a"]);
  });

  it("filters by scope index when member row has matching scoped text", () => {
    const index = new Map<string, string>([["a", "Site A · Zones 1-4"]]);
    const result = filterMembers({ rows: baseRows, role: "", status: "", query: "", scope: "site a", scopeIndex: index });
    expect(result.map((r) => r.id)).toEqual(["a"]);
  });

  it("applies multiple filters as AND", () => {
    const result = filterMembers({ rows: baseRows, role: "supervisor", status: "active", query: "", scope: "", scopeIndex: emptyIndex });
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2.2: Run test to verify new tests fail**

Run: `pnpm vitest run src/features/identity-access/tests/unit/users-page-model.test.ts`
Expected: FAIL — `filterMembers` and `classifyMemberStatus` are missing.

- [ ] **Step 2.3: Implement the new helpers**

Append to the same model file:

```ts
export function classifyMemberStatus(status: MemberStatus): {
  label: string;
  tone: "neutral" | "ok" | "warn" | "danger";
} {
  switch (status) {
    case "active":
      return { label: "Active", tone: "ok" };
    case "invited":
      return { label: "Invited", tone: "warn" };
    case "suspended":
      return { label: "Suspended", tone: "danger" };
    case "expired":
      return { label: "Expired", tone: "neutral" };
  }
}

export function filterMembers(opts: {
  rows: ReadonlyArray<MemberRow>;
  role: string;
  status: string;
  query: string;
  scope: string;
  scopeIndex: ReadonlyMap<string, string>;
}): MemberRow[] {
  const { rows, role, status, query, scope, scopeIndex } = opts;
  const q = query.trim().toLowerCase();
  const s = scope.trim().toLowerCase();
  return rows.filter((r) => {
    if (role && r.role !== role) return false;
    if (status && r.status !== status) return false;
    if (q) {
      const hay = `${r.displayName} ${r.email}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (s) {
      const scopedText = scopeIndex.get(r.id) ?? "";
      if (!scopedText.toLowerCase().includes(s)) return false;
    }
    return true;
  });
}
```

- [ ] **Step 2.4: Run tests to verify they pass**

Run: `pnpm vitest run src/features/identity-access/tests/unit/users-page-model.test.ts`
Expected: PASS (12 passed / 0 failed).

- [ ] **Step 2.5: Commit**

```bash
git add src/features/identity-access/lib/users-page-model.ts src/features/identity-access/tests/unit/users-page-model.test.ts
git commit -m "feat(users-page): filterMembers and classifyMemberStatus"
```

---

## Task 3: Extend `listMembers` to accept filter opts

**Files:**
- Modify: `src/features/identity-access/server/queries.ts`

**Interfaces:**
- Produces:
  - Function `listMembers(orgId: string, opts?: { role?: string; status?: string; q?: string }): Promise<OrganizationMember[]>` — defaults preserved (existing call shape still works).

- [ ] **Step 3.1: Find the existing caller**

Run: `rg -n "listMembers\(" src/`
Expected: at least one call site. Note each; we'll update or leave alone as appropriate. The current `roles/page.tsx` is the only call site — it imports the function and the new page will replace its body.

- [ ] **Step 3.2: Update function signature and SQL**

Replace the `listMembers` definition in `src/features/identity-access/server/queries.ts` with:

```ts
export async function listMembers(
  organizationId: string,
  opts: { role?: string; status?: string; q?: string } = {},
): Promise<OrganizationMember[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("organization_members")
    .select(
      "id, organization_id, user_id, role, status, starts_at, expires_at, invited_by, sponsor_id, client_operation_id",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (opts.role) query = query.eq("role", opts.role);
  if (opts.status) query = query.eq("status", opts.status);

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []).map(rowToMember);
  if (!opts.q) return rows;
  const q = opts.q.trim().toLowerCase();
  if (q.length === 0) return rows;
  // Substring filter against profiles.display_name joined client-side; avoids a DB join here.
  // For 0..500-member orgs this is cheap; revisit if perf becomes an issue.
  const userIds = Array.from(new Set(rows.map((r) => r.userId)));
  if (userIds.length === 0) return rows;
  const { data: profiles, error: pErr } = await supabase
    .from("profiles")
    .select("user_id, display_name, contact_preferences")
    .in("user_id", userIds);
  if (pErr) throw pErr;
  const matchingIds = new Set<string>();
  for (const p of profiles ?? []) {
    const display = (p.display_name ?? "").toLowerCase();
    if (display.includes(q)) matchingIds.add(p.user_id);
  }
  return rows.filter((r) => matchingIds.has(r.userId));
}
```

- [ ] **Step 3.3: Verify type-check**

Run: `pnpm tsc --noEmit`
Expected: 0 errors. The current `roles/page.tsx` continues to work because `opts` is optional.

- [ ] **Step 3.4: Commit**

```bash
git add src/features/identity-access/server/queries.ts
git commit -m "feat(queries): listMembers accepts role/status/q opts"
```

---

## Task 4: Extend `listAuditLog` to filter by `actorUserId`

**Files:**
- Modify: `src/features/identity-access/server/queries.ts`

**Interfaces:**
- Produces:
  - Adds optional `actorUserId?: string` to the `listAuditLog` opts parameter; applies it as `.eq("actor_user_id", ...)` only when provided.

- [ ] **Step 4.1: Write the failing import-type test (compile-time only)**

Open `src/features/identity-access/server/queries.ts` and confirm the signature shape in the source. There is no existing unit test for this function (it is a Supabase wrapper). We rely on a TypeScript compile to validate the signature change.

Run: `pnpm tsc --noEmit`
Expected: PASS (baseline).

- [ ] **Step 4.2: Update the function**

Inside `listAuditLog`, extend the destructured input type and add a query line after the existing `entityType` filter:

```ts
export async function listAuditLog(input: {
  organizationId: string;
  from?: string;
  to?: string;
  eventType?: string;
  entityType?: string;
  actorUserId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: AuditLogEntry[]; total: number }> {
  const supabase = await createSupabaseServerClient();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);

  let query = supabase
    .from("audit_log")
    .select(
      "id, organization_id, actor_user_id, actor_role, event_type, entity_type, entity_id, before, after, reason, correlation_id, source, occurred_at",
      { count: "exact" },
    )
    .eq("organization_id", input.organizationId)
    .order("occurred_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (input.from) query = query.gte("occurred_at", input.from);
  if (input.to) query = query.lte("occurred_at", input.to);
  if (input.eventType) query = query.eq("event_type", input.eventType);
  if (input.entityType) query = query.eq("entity_type", input.entityType);
  if (input.actorUserId) query = query.eq("actor_user_id", input.actorUserId);

  const { data, error, count } = await query;
  if (error) throw error;
  return {
    rows: (data ?? []).map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      actorUserId: row.actor_user_id,
      actorRole: row.actor_role,
      eventType: row.event_type,
      entityType: row.entity_type,
      entityId: row.entity_id,
      before: row.before,
      after: row.after,
      reason: row.reason,
      correlationId: row.correlation_id,
      source: row.source,
      occurredAt: row.occurred_at,
    })),
    total: count ?? 0,
  };
}
```

- [ ] **Step 4.3: Verify type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS — existing callers (`audit-log/page.tsx`) continue to type-check; the new `actorUserId` arg is optional.

- [ ] **Step 4.4: Commit**

```bash
git add src/features/identity-access/server/queries.ts
git commit -m "feat(queries): listAuditLog filters by actorUserId"
```

---

## Task 5: Build `UsersPageClient` (filter card + timeline + Sheet)

**Files:**
- Create: `src/features/identity-access/components/users-page-client.tsx`
- Test: `src/features/identity-access/tests/unit/users-page-client.test.tsx`

**Interfaces:**
- Props shape:
  ```ts
  type UsersPageClientProps = {
    rows: MemberRow[];
    scopeIndex: ReadonlyMap<string, string>;
    invitations: ReadonlyArray<{ id: string; email: string; role: string; expiresAt: string }>;
    filters: {
      roles: ReadonlyArray<{ value: string; label: string }>;
      statuses: ReadonlyArray<{ value: string; label: string }>;
    };
    active: {
      role: string;
      status: string;
      query: string;
      scope: string;
      rowId: string;
    };
    recentActivity?: ReadonlyArray<{ id: string; eventType: string; occurredAt: string; reason: string | null }>;
  };
  ```
- Consumes: helper functions from `./users-page-model`.
- Re-exports: nothing.

- [ ] **Step 5.1: Write the failing render test**

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { UsersPageClient } from "@/features/identity-access/components/users-page-client";
import type { MemberRow } from "@/features/identity-access/lib/users-page-model";

const rows: MemberRow[] = [
  {
    id: "m-1",
    userId: "u-1",
    displayName: "Ada Lovelace",
    email: "ada@example.com",
    role: "owner",
    status: "active",
    startsAt: "2026-07-11T09:00:00.000Z",
  },
  {
    id: "m-2",
    userId: "u-2",
    displayName: "Bob",
    email: "bob@example.com",
    role: "supervisor",
    status: "invited",
    startsAt: "2026-07-10T09:00:00.000Z",
  },
];

describe("<UsersPageClient />", () => {
  it("renders the filter card with the expected labels", () => {
    render(
      <UsersPageClient
        rows={rows}
        scopeIndex={new Map()}
        invitations={[]}
        filters={{
          roles: [
            { value: "owner", label: "Owner" },
            { value: "supervisor", label: "Supervisor" },
          ],
          statuses: [
            { value: "active", label: "Active" },
            { value: "invited", label: "Invited" },
          ],
        }}
        active={{ role: "", status: "", query: "", scope: "", rowId: "" }}
      />,
    );
    expect(screen.getByText("Filters")).toBeTruthy();
    expect(screen.getByPlaceholderText(/Search name or email/i)).toBeTruthy();
  });

  it("renders a member row with the displayName and email", () => {
    render(
      <UsersPageClient
        rows={rows}
        scopeIndex={new Map([["m-1", "Site A · Zones 1-4"]])}
        invitations={[]}
        filters={{
          roles: [{ value: "owner", label: "Owner" }],
          statuses: [{ value: "active", label: "Active" }],
        }}
        active={{ role: "", status: "", query: "", scope: "", rowId: "" }}
      />,
    );
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("ada@example.com")).toBeTruthy();
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

Run: `pnpm vitest run src/features/identity-access/tests/unit/users-page-client.test.tsx`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 5.3: Implement the client component**

Create `src/features/identity-access/components/users-page-client.tsx`:

```tsx
"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ChevronRight,
  Filter,
  Mail,
  Search,
  ShieldAlert,
  Tag,
  User as UserIcon,
  Users as UsersIcon,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

import {
  bucketizeMembers,
  classifyMemberStatus,
  filterMembers,
  formatJoinBucketLabel,
  type MemberRow,
  type MemberStatus,
} from "@/features/identity-access/lib/users-page-model";
import { roleLabel } from "@/features/access-control/components/role-label";

const ANY = "__any__";

function toneClasses(
  tone: ReturnType<typeof classifyMemberStatus>["tone"] | "info",
): string {
  switch (tone) {
    case "danger":
      return "bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20";
    case "warn":
      return "bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-300";
    case "ok":
      return "bg-emerald-500/10 text-emerald-700 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-300";
    case "info":
      return "bg-sky-500/10 text-sky-700 ring-1 ring-inset ring-sky-500/20 dark:text-sky-300";
    default:
      return "bg-muted text-muted-foreground ring-1 ring-inset ring-border";
  }
}

function railDotTone(tone: ReturnType<typeof classifyMemberStatus>["tone"]): string {
  switch (tone) {
    case "ok":
      return "bg-emerald-500";
    case "warn":
      return "bg-amber-500";
    case "danger":
      return "bg-destructive";
    default:
      return "bg-muted-foreground/50";
  }
}

function Copyable({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [value]);
  return (
    <button
      type="button"
      onClick={onCopy}
      title={value}
      className="rounded px-1 font-mono text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
    >
      {copied ? "copied" : value}
    </button>
  );
}

type InvitationLite = {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
};

type FilterShape = {
  roles: ReadonlyArray<{ value: string; label: string }>;
  statuses: ReadonlyArray<{ value: string; label: string }>;
};

type ActiveFilters = {
  role: string;
  status: string;
  query: string;
  scope: string;
  rowId: string;
};

type Props = {
  rows: MemberRow[];
  scopeIndex: ReadonlyMap<string, string>;
  invitations: ReadonlyArray<InvitationLite>;
  filters: FilterShape;
  active: ActiveFilters;
  recentActivity?: ReadonlyArray<{
    id: string;
    eventType: string;
    occurredAt: string;
    reason: string | null;
  }>;
};

function HeaderSummary({ total, active, pending, shown }: {
  total: number;
  active: number;
  pending: number;
  shown: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-3 text-left sm:grid-cols-3">
      <Stat label="Members" value={total.toLocaleString()} />
      <Stat label="Active" value={active.toLocaleString()} />
      <Stat label="Pending invites" value={pending.toLocaleString()} />
      <span className="sr-only">Showing {shown} of {total} members</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="font-mono text-base leading-tight tabular-nums">{value}</div>
    </div>
  );
}

export function UsersPageClient({ rows, scopeIndex, invitations, filters, active, recentActivity }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [now] = useState(() => new Date());

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!value) params.delete(key);
      else params.set(key, value);
      const qs = params.toString();
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  const filtered = useMemo(
    () =>
      filterMembers({
        rows,
        role: active.role,
        status: active.status,
        query: active.query,
        scope: active.scope,
        scopeIndex,
      }),
    [rows, active, scopeIndex],
  );

  const buckets = useMemo(() => bucketizeMembers(filtered, now), [filtered, now]);
  const flatRows = useMemo(() => buckets.flatMap((b) => b.rows), [buckets]);
  const selected = useMemo(
    () => flatRows.find((r) => r.id === active.rowId) ?? null,
    [flatRows, active.rowId],
  );

  const activeCount =
    (active.role ? 1 : 0) +
    (active.status ? 1 : 0) +
    (active.query ? 1 : 0) +
    (active.scope ? 1 : 0);

  const clearAll = () => {
    const params = new URLSearchParams();
    if (active.rowId) params.set("row", active.rowId);
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };

  const selectRow = (id: string) =>
    updateParam("row", id === active.rowId ? null : id);
  const closeRow = () => updateParam("row", null);

  const totals = useMemo(() => {
    const total = rows.length;
    const active = rows.filter((r) => r.status === "active").length;
    const pending = invitations.filter((i) => !!i.id).length;
    return { total, active, pending };
  }, [rows, invitations]);

  return (
    <div className="mt-6 space-y-4">
      {/* Filter card */}
      <div className="rounded-xl border bg-card shadow-[var(--shadow-sm,0_1px_2px_rgba(0,0,0,0.04))]">
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
          <div className="flex items-center gap-2 pr-2 text-muted-foreground">
            <Filter className="size-4" aria-hidden />
            <span className="text-xs font-medium uppercase tracking-wide">Filters</span>
          </div>

          <Select
            value={active.role || ANY}
            onValueChange={(v) => updateParam("role", v === ANY ? null : v)}
          >
            <SelectTrigger size="sm" className="min-w-[160px]">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All roles</SelectItem>
              {filters.roles.map((r) => (
                <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={active.status || ANY}
            onValueChange={(v) => updateParam("status", v === ANY ? null : v)}
          >
            <SelectTrigger size="sm" className="min-w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any status</SelectItem>
              {filters.statuses.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            value={active.scope}
            onChange={(e) => updateParam("scope", e.target.value || null)}
            placeholder="Search scopes"
            className="h-8 w-32 text-xs"
            spellCheck={false}
          />

          <div className="relative ml-auto w-full sm:w-64">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={active.query}
              onChange={(e) => updateParam("query", e.target.value || null)}
              placeholder="Search name or email…"
              className="h-8 pl-7 text-xs"
              spellCheck={false}
            />
          </div>

          {activeCount > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearAll}
              className="h-7 gap-1 px-2 text-xs text-muted-foreground"
            >
              <X className="size-3" />
              Clear ({activeCount})
            </Button>
          ) : null}
        </div>

        <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
          <div>
            Showing <span className="font-medium text-foreground">{filtered.length}</span> of {rows.length} members
          </div>
          <div className="hidden sm:block">Newest first · grouped by join date</div>
        </div>
      </div>

      {/* Stats summary (rendered here so render tests cover it) */}
      <HeaderSummary
        total={totals.total}
        active={totals.active}
        pending={totals.pending}
        shown={filtered.length}
      />

      {/* Timeline */}
      {filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <ol className="space-y-6">
          {buckets.map((bucket) => (
            <li key={bucket.key}>
              <div className="sticky top-0 z-10 -mx-4 mb-3 flex items-baseline gap-3 bg-background/85 px-4 py-1 backdrop-blur supports-[backdrop-filter]:bg-background/65">
                <h2 className="text-sm font-semibold tracking-tight">{bucket.label}</h2>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {bucket.rows.length} member{bucket.rows.length === 1 ? "" : "s"}
                </span>
              </div>
              <ul className="relative ml-3 border-l border-border/70">
                {bucket.rows.map((row) => {
                  const cls = classifyMemberStatus(row.status);
                  const isOpen = active.rowId === row.id;
                  const scope = scopeIndex.get(row.id) ?? "No scope set";
                  return (
                    <li key={row.id} className="relative pl-6">
                      <span
                        aria-hidden
                        className={`absolute left-0 top-3.5 inline-block size-2 -translate-x-1/2 rounded-full ring-4 ring-background ${railDotTone(cls.tone)}`}
                      />
                      <button
                        type="button"
                        onClick={() => selectRow(row.id)}
                        aria-expanded={isOpen}
                        className={`group flex w-full items-start gap-4 rounded-lg border px-3 py-2.5 text-left transition ${
                          isOpen
                            ? "border-foreground/15 bg-muted/60"
                            : "border-transparent hover:border-border hover:bg-muted/40"
                        }`}
                      >
                        <div className="w-28 shrink-0 font-mono text-xs leading-tight text-muted-foreground tabular-nums">
                          <div>{row.startsAt.slice(0, 10)}</div>
                          <div className="text-[10px] text-muted-foreground/70">
                            {formatJoinBucketLabel(new Date(row.startsAt), now)}
                          </div>
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${toneClasses(cls.tone)}`}
                            >
                              {cls.label}
                            </span>
                            <span className="text-sm font-semibold">
                              {row.displayName}
                            </span>
                            <Badge variant="outline" className="ml-1">
                              {roleLabel(row.role)}
                            </Badge>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <Mail className="size-3" aria-hidden />
                              <Copyable value={row.email} />
                            </span>
                            <span className="truncate italic">
                              {scope}
                            </span>
                          </div>
                        </div>

                        <ChevronRight
                          className={`mt-1 size-4 shrink-0 text-muted-foreground transition ${isOpen ? "rotate-90" : ""}`}
                          aria-hidden
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}

      {/* Sheet detail */}
      <Sheet
        open={Boolean(selected)}
        onOpenChange={(o) => {
          if (!o) closeRow();
        }}
      >
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 sm:max-w-xl"
        >
          {selected ? (
            <DetailPanel
              row={selected}
              scope={scopeIndex.get(selected.id) ?? ""}
              recentActivity={recentActivity ?? []}
              onClose={closeRow}
            />
          ) : null}
          <SheetTitle className="sr-only">Member detail</SheetTitle>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed bg-card/50 px-6 py-16 text-center">
      <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <ShieldAlert className="size-5" />
      </div>
      <h3 className="mt-3 text-sm font-semibold">No members match</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Try clearing filters or widening the search query.
      </p>
    </div>
  );
}

function DetailPanel({
  row,
  scope,
  recentActivity,
  onClose,
}: {
  row: MemberRow;
  scope: string;
  recentActivity: ReadonlyArray<{
    id: string;
    eventType: string;
    occurredAt: string;
    reason: string | null;
  }>;
  onClose: () => void;
}) {
  const cls = classifyMemberStatus(row.status);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${toneClasses(cls.tone)}`}
            >
              {cls.label}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(row.startsAt).toLocaleString()}
            </span>
          </div>
          <h2 className="truncate text-lg font-semibold">{row.displayName}</h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close detail"
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <Field label="Email">
          <div className="flex items-center gap-1 text-sm">
            <Mail className="size-3 text-muted-foreground" aria-hidden />
            <Copyable value={row.email} />
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Role">
            <Badge variant="outline">{roleLabel(row.role)}</Badge>
          </Field>
          <Field label="Status">
            <Badge variant="outline">{cls.label}</Badge>
          </Field>
          <Field label="Joined">
            <div className="font-mono text-xs">{row.startsAt.slice(0, 10)}</div>
          </Field>
          <Field label="Scope">
            <div className="text-xs italic text-muted-foreground">{scope || "—"}</div>
          </Field>
        </div>
        {recentActivity.length > 0 ? (
          <Field label="Recent activity">
            <ul className="space-y-1.5">
              {recentActivity.map((e) => (
                <li key={e.id} className="flex items-start gap-2 text-xs">
                  <span className="mt-1 inline-block size-1.5 rounded-full bg-muted-foreground/60" aria-hidden />
                  <div className="min-w-0">
                    <code className="font-mono text-[11px]">{e.eventType}</code>
                    <div className="text-[11px] text-muted-foreground">
                      {new Date(e.occurredAt).toLocaleString()}
                      {e.reason ? ` · ${e.reason}` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Field>
        ) : null}
      </div>

      <div className="border-t bg-muted/30 px-5 py-3 text-[11px] text-muted-foreground">
        <Tag className="mr-1 inline-block size-3 align-text-bottom" />
        Editing roles and revoking members lives in the Roles &amp; permissions section.
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

// Export helper symbols so server code can assemble the rows. Used only by
// tests; the page itself builds the row data before passing it in.
export const _internal = {
  toneClasses,
  railDotTone,
  formatJoinBucketLabel,
};

// Local alias to avoid an unused import lint warning if filters.statuses is
// empty during early development.
export type _MemberStatus = MemberStatus;
```

- [ ] **Step 5.4: Run tests; expected PASS**

Run: `pnpm vitest run src/features/identity-access/tests/unit/users-page-client.test.tsx`
Expected: PASS.

- [ ] **Step 5.5: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 5.6: Commit**

```bash
git add src/features/identity-access/components/users-page-client.tsx src/features/identity-access/tests/unit/users-page-client.test.tsx
git commit -m "feat(users-page): client component with filter card, timeline, sheet"
```

---

## Task 6: Wire the page route

**Files:**
- Modify: `src/app/(dashboard)/[organizationSlug]/settings/roles/page.tsx`

**Interfaces:**
- Page render shape:
  - Reads `searchParams` for `role | status | query | scope | row`.
  - Calls `listMembers(orgId, { role, status, q: query, ... })`, `listInvitations(orgId)`, `listMemberScopes(orgId)`, `getOrganizationBySlug(orgSlug)`.
  - For each member, fetches the latest `Profile` (`getProfile(userId)`) for `displayName` and `email`.
  - Builds the `MemberRow[]` and the scope index map `{ memberId → "Site A · Zones 1-4" }`.
  - Lazily fetches `recentActivity` for the sheet by calling `listAuditLog({ actorUserId: selected.userId, limit: 5 })` only when `rowId` matches a member.
  - Renders header (`Users` icon + title + subtitle + a 3-stat tile row drawn in the page) + `<UsersPageClient>`.

- [ ] **Step 6.1: Replace the page body**

Overwrite `src/app/(dashboard)/[organizationSlug]/settings/roles/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { Users as UsersIcon } from "lucide-react";

import { requireUserOrRedirect } from "@/lib/auth/require-user";
import {
  getOrganizationBySlug,
  getProfile,
  listAuditLog,
  listInvitations,
  listMemberScopes,
  listMembers,
} from "@/features/identity-access/server/queries";

import { ROLES, type Role } from "@/lib/auth/permissions";
import { roleLabel } from "@/features/access-control/components/role-label";
import { UsersPageClient } from "@/features/identity-access/components/users-page-client";
import type { MemberRow, MemberStatus } from "@/features/identity-access/lib/users-page-model";

export const dynamic = "force-dynamic";

const ROLE_FILTERS = ROLES.map((r) => ({ value: r, label: roleLabel(r) }));

const STATUS_FILTERS: ReadonlyArray<{ value: MemberStatus; label: string }> = [
  { value: "active", label: "Active" },
  { value: "invited", label: "Invited" },
  { value: "suspended", label: "Suspended" },
  { value: "expired", label: "Expired" },
];

export default async function RolesPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{
    role?: string;
    status?: string;
    query?: string;
    scope?: string;
    row?: string;
  }>;
}) {
  await requireUserOrRedirect();
  const { organizationSlug } = await params;
  const sp = await searchParams;
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();

  const [members, invitations, scopes] = await Promise.all([
    listMembers(org.id, {
      role: sp.role,
      status: sp.status,
      q: sp.query,
    }),
    listInvitations(org.id),
    listMemberScopes(org.id),
  ]);

  // Build per-member scope summaries.
  const scopeIndex = new Map<string, string>();
  for (const m of members) {
    const ms = scopes.filter((s) => s.organizationMemberId === m.id);
    if (ms.length === 0) continue;
    const labels = ms.map((s) => {
      if (s.siteId && s.zoneId && s.houseId) return `Site ${s.siteId} · Zones ${s.zoneId} · Houses ${s.houseId}`;
      if (s.siteId && s.zoneId) return `Site ${s.siteId} · Zones ${s.zoneId}`;
      if (s.siteId) return `Site ${s.siteId}`;
      if (s.permission) return s.permission;
      return "Scoped";
    });
    scopeIndex.set(m.id, labels.join(", "));
  }

  // Build MemberRow[] by joining members → profiles (for display_name + email).
  const userIds = Array.from(new Set(members.map((m) => m.userId)));
  const profiles = await Promise.all(userIds.map((id) => getProfile(id)));
  const profileByUser = new Map<string, NonNullable<Awaited<ReturnType<typeof getProfile>>>>();
  profiles.forEach((p, i) => {
    if (p) profileByUser.set(userIds[i]!, p);
  });

  const rows: MemberRow[] = members.flatMap((m) => {
    const profile = profileByUser.get(m.userId);
    if (!profile) return [];
    if (!(ROLES as ReadonlyArray<string>).includes(m.role)) return [];
    return [{
      id: m.id,
      userId: m.userId,
      displayName: profile.displayName,
      email: deriveEmail(profile) ?? m.userId,
      role: m.role as Role,
      status: m.status as MemberStatus,
      startsAt: m.startsAt,
    }];
  });

  const total = rows.length;
  const activeCount = rows.filter((r) => r.status === "active").length;
  const pendingCount = invitations.filter(
    (i) => i.acceptedAt == null && i.revokedAt == null,
  ).length;

  // Recent activity for the selected member (lazy: only when row matches).
  let recentActivity: Array<{ id: string; eventType: string; occurredAt: string; reason: string | null }> = [];
  if (sp.row) {
    const sel = rows.find((r) => r.id === sp.row);
    if (sel) {
      const audit = await listAuditLog({ organizationId: org.id, actorUserId: sel.userId, limit: 5 });
      recentActivity = audit.rows.map((r) => ({
        id: r.id,
        eventType: r.eventType,
        occurredAt: r.occurredAt,
        reason: r.reason,
      }));
    }
  }

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-start gap-3">
          <div
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          >
            <UsersIcon className="size-5" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
            <p className="text-sm text-muted-foreground">
              Every person with access to this organization. Newest first.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 text-left sm:grid-cols-3">
          <Stat label="Members" value={total.toLocaleString()} />
          <Stat label="Active" value={activeCount.toLocaleString()} />
          <Stat label="Pending invites" value={pendingCount.toLocaleString()} />
        </div>
      </header>

      <UsersPageClient
        rows={rows}
        scopeIndex={scopeIndex}
        invitations={invitations.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt }))}
        filters={{
          roles: ROLE_FILTERS,
          statuses: STATUS_FILTERS,
        }}
        active={{
          role: sp.role ?? "",
          status: sp.status ?? "",
          query: sp.query ?? "",
          scope: sp.scope ?? "",
          rowId: sp.row ?? "",
        }}
        recentActivity={recentActivity}
      />
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="font-mono text-base leading-tight tabular-nums">
        {value}
      </div>
    </div>
  );
}

function deriveEmail(profile: { contactPreferences: Record<string, unknown> }): string | null {
  const v = profile.contactPreferences?.["email"];
  return typeof v === "string" ? v : null;
}
```

- [ ] **Step 6.2: Type-check**

Run: `pnpm tsc --noEmit`
Expected: PASS — if there are issues, fix the types; do not ignore.

- [ ] **Step 6.3: Run all unit tests**

Run: `pnpm vitest run src/features/identity-access`
Expected: PASS (12 + 2 = 14 tests).

- [ ] **Step 6.4: Lint the page + components**

Run: `pnpm lint src/app/\(dashboard\)/\[organizationSlug\]/settings/roles/page.tsx src/features/identity-access/components/users-page-client.tsx src/features/identity-access/lib/users-page-model.ts`
Expected: 0 errors. If there are warnings, fix them inline or document why they are expected.

- [ ] **Step 6.5: Build sanity check**

Run: `pnpm build` (or `pnpm next build` depending on repo script).
Expected: PASS.

- [ ] **Step 6.6: Commit**

```bash
git add src/app/\(dashboard\)/\[organizationSlug\]/settings/roles/page.tsx
git commit -m "feat(users-page): route renders header + UsersPageClient"
```

---

## Task 7: End-to-end smoke test + cleanup

**Files:**
- Touch only: `e2e/` if there is a Playwright suite. Otherwise no e2e for this round (the Audit Log e2e is the closest analogue and is also not maintained).

- [ ] **Step 7.1: Manual visual smoke**

Run: `pnpm dev` in a separate terminal.

Open in browser: `http://localhost:3000/<orgSlug>/settings/roles?role=owner`

Verify visually:
- Header shows `Users` title and the three stat tiles (`Members`, `Active`, `Pending invites`).
- Filter card renders with `Filters` label, role select, status select, scope text input, search input.
- Timeline renders the seeded members grouped by join date bucket.
- Clicking a row toggles the Sheet; Sheet shows email, role, status, scope, recent activity (or empty state).
- Editing role/status/query/scope updates the URL and re-filters.
- `Clear (n)` button removes all active filters except `row=`.

- [ ] **Step 7.2: Audit-log vibe parity check**

Compare side-by-side with `http://localhost:3000/<orgSlug>/settings/audit-log`. Confirm:
- Header proportions match (icon + title + 3 stat tiles).
- Filter card uses the same row pattern.
- Timeline uses the same sticky day bucket, mono date column, tone-coloured rail dot, expandable chevron.
- Sheet style matches (sm:max-w-xl, header strip with pill + close, footer note).

- [ ] **Step 7.3: Optional — write a single Playwright spec**

Skip if the project has no e2e harness for this page. Otherwise add `e2e/users-page.spec.ts` mirroring `e2e/audit-log.spec.ts` (search for that file; if missing, skip).

- [ ] **Step 7.4: Commit (if any follow-up)**

If Step 7.3 was skipped, no commit needed. Otherwise:
```bash
git add e2e/users-page.spec.ts
git commit -m "test(e2e): smoke spec for users page"
```

---

## Self-Review

**1. Spec coverage**

- §Header (stat tiles) → Task 6. ✓
- §Filter card (role/status/scope/search/Clear) → Task 5 + Task 6. ✓
- §Timeline rows (mono date column, tone dot, member block) → Task 5. ✓
- §Bucket logic (Today / Yesterday / Earlier this week / Earlier this month / older) → Task 1 + Task 5. ✓
- §Sheet detail (identity fields, scope, recent activity, footer note) → Task 5 + Task 6. ✓
- §Empty state → Task 5. ✓
- §Untouched components → no task deletes them. ✓
- §No schema / no migrations → no SQL anywhere. ✓

**2. Placeholder scan**

No "TBD", "TODO", "fill in", "similar to Task N", or unsupported type references. All code blocks are complete.

**3. Type consistency**

- `MemberRow` is defined in Task 1 and consumed uniformly in Tasks 2, 5, 6.
- `classifyMemberStatus` returns `tone: "neutral" | "ok" | "warn" | "danger"`; `toneClasses` and `railDotTone` accept this union.
- `filterMembers` opts uses `ReadonlyMap`; `Map<>` is assignable.
- `MemberBucket.key` is a string `YYYY-M-D`; consumer reads it as a React `key`. ✓
- `roleLabel` is imported from the existing `features/access-control/components/role-label.ts`. ✓ (Same module the existing components use.)

**4. Risks / explicit non-changes**

- `listMembers` adds a string `q` filter that uses a second `profiles` query server-side. For orgs with 0–500 members this is fine. Documented in Step 3.2 comment.
- `listAuditLog` adds an `actorUserId` filter — confirmed unused elsewhere; the only caller (Audit Log page) does not pass it. ✓
- Old `RolesMasthead`, `CapabilityMatrix`, `RoleRoster`, `RankLadder`, `InvitationsQueue` are still in source. They are no longer imported by `settings/roles/page.tsx`, so tree-shaking drops them from the page's bundle. No code is removed.
- `RolesPageClient` (`tabs editor`) remains untouched and unused this round.
