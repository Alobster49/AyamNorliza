import type { Role } from "@/lib/auth/permissions";
export type { Role };

export type MemberStatus = "invited" | "active" | "suspended" | "expired";

export type MemberRow = {
  id: string;
  userId: string;
  displayName: string;
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
  return d.toISOString().slice(0, 10);
}

function daysBetween(date: Date, now: Date): number {
  const dateDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((nowDay - dateDay) / 86_400_000);
}

export function formatJoinBucketLabel(date: Date, now: Date = new Date()): string {
  const diff = daysBetween(date, now);
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
  for (const bucket of groups.values()) {
    bucket.rows.sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  }
  return Array.from(groups.values()).sort((a, b) => b.key.localeCompare(a.key));
}

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
      const hay = `${r.displayName} ${r.userId}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (s) {
      const scopedText = scopeIndex.get(r.id) ?? "";
      if (!scopedText.toLowerCase().includes(s)) return false;
    }
    return true;
  });
}
