import { getTranslations } from "next-intl/server";
import type { Role } from "@/lib/auth/permissions";
import { buildRoleRoster } from "../lib/capability-matrix";
import { roleLabelKey } from "./role-label";

/**
 * Live role roster — turns "who is in this org right now" into a ranked list
 * of human counts per role. Server component, fed by `listMembers()`.
 *
 * The caller is responsible for narrowing `member.role` from `string` to
 * `Role` — that's a DB concern, not a UI concern.
 */
export async function RoleRoster({
  members,
  totalMembers,
}: {
  members: ReadonlyArray<{ role: Role }>;
  totalMembers: number;
}) {
  const roster = buildRoleRoster(members);
  const maxCount = Math.max(1, ...roster.map((r) => r.count));
  const [t, tRoles] = await Promise.all([
    getTranslations("identity.roleRoster"),
    getTranslations("roles"),
  ]);

  return (
    <section aria-labelledby="roster-heading" className="space-y-5">
      <header className="flex items-baseline justify-between">
        <h2
          id="roster-heading"
          className="font-display text-2xl leading-none"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("heading")}
        </h2>
        <span className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
          {t("activeCount", { count: totalMembers })}
        </span>
      </header>

      <p className="text-xs text-muted-foreground">
        {t("description")}
      </p>

      <ul className="divide-y divide-foreground/10">
        {roster.map((entry) => {
          const widthPct = (entry.count / maxCount) * 100;
          const isPeak = entry.count > 0 && entry.count === maxCount && totalMembers > 0;
          return (
            <li
              key={entry.role}
              className="grid grid-cols-[1fr_auto] items-center gap-3 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">
                    {tRoles(roleLabelKey(entry.role))}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {entry.count}
                  </span>
                </div>
                <div
                  className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-foreground/10"
                  aria-hidden
                >
                  <div
                  className={
                    "h-full rounded-full " +
                    (isPeak
                      ? "bg-[var(--editorial-accent)]"
                      : "bg-foreground/40")
                  }
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
