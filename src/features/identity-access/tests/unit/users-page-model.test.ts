import { describe, expect, it } from "vitest";
import { ROLES } from "@/lib/auth/permissions";
import {
  bucketizeMembers,
  classifyMemberStatus,
  filterMembers,
  formatJoinBucketLabel,
  type MemberRow,
  type Role,
} from "@/features/identity-access/lib/users-page-model";

const now = new Date("2026-07-11T12:00:00.000Z");

function row(partial: Partial<MemberRow> & { startsAt: string; id: string }): MemberRow {
  return {
    id: partial.id,
    userId: partial.userId ?? `user-${partial.id}`,
    displayName: partial.displayName ?? `Name ${partial.id}`,
    role: partial.role ?? "driver",
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
    expect(buckets[0]!.label).toBe("Today");
    expect(buckets[0]!.rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(buckets[1]!.label).toBe("Yesterday");
    expect(buckets[1]!.rows.map((r) => r.id)).toEqual(["c"]);
    expect(buckets[2]!.label).toMatch(/Jan/);
  });

  it("returns an empty array for empty input", () => {
    expect(bucketizeMembers([], now)).toEqual([]);
  });

  it("orders buckets chronologically newest-first even when string comparison would disagree (01-02 vs 01-10)", () => {
    const early = row({ id: "x", startsAt: "2026-01-02T00:00:00.000Z" });
    const late = row({ id: "y", startsAt: "2026-01-10T00:00:00.000Z" });

    const buckets = bucketizeMembers([early, late], now);

    expect(buckets).toHaveLength(2);
    expect(buckets[0]!.key).toBe("2026-01-10");
    expect(buckets[0]!.rows.map((r) => r.id)).toEqual(["y"]);
    expect(buckets[1]!.key).toBe("2026-01-02");
    expect(buckets[1]!.rows.map((r) => r.id)).toEqual(["x"]);
  });

  it("emits zero-padded UTC day keys (YYYY-MM-DD)", () => {
    const r = row({ id: "p", startsAt: "2026-03-05T07:30:00.000Z" });

    const buckets = bucketizeMembers([r], now);

    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.key).toBe("2026-03-05");
  });
});

describe("Role re-export", () => {
  it("re-exports Role as a literal-union type assignable to ROLES entries", () => {
    const sample: Role = "driver";
    expect(ROLES).toContain(sample);
  });
});

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
    row({ id: "a", startsAt: "2026-07-11T09:00:00Z", role: "owner", status: "active", displayName: "Ada Lovelace", userId: "u-1" }),
    row({ id: "b", startsAt: "2026-07-10T09:00:00Z", role: "supervisor", status: "invited", displayName: "Bob", userId: "u-2" }),
    row({ id: "c", startsAt: "2026-07-09T09:00:00Z", role: "driver", status: "suspended", displayName: "Cici", userId: "u-3" }),
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

  it("filters by query across name + userId", () => {
    const result = filterMembers({ rows: baseRows, role: "", status: "", query: "u-1", scope: "", scopeIndex: emptyIndex });
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
