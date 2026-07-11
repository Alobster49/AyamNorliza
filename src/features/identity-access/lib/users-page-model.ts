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
