import { getTranslations } from "next-intl/server";
import { buildRankLadder } from "../lib/capability-matrix";
import { roleLabelKey } from "./role-label";

/**
 * Rank ladder — visualizes the per-role weights on a 0–100 scale. Pure
 * server component. The accent color highlights the highest tier.
 *
 * Why it matters: the editor is reading this to understand the *shape* of
 * privilege in the organization, not just the individual rows.
 */
export async function RankLadder() {
  const ladder = buildRankLadder();
  const maxRank = 100;
  const [t, tRoles] = await Promise.all([
    getTranslations("identity.rankLadder"),
    getTranslations("roles"),
  ]);

  return (
    <section
      aria-labelledby="ladder-heading"
      className="space-y-5 border-t border-foreground/10 pt-8"
    >
      <header className="flex items-baseline justify-between">
        <h2
          id="ladder-heading"
          className="font-display text-2xl leading-none"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("heading")}
        </h2>
        <span className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
          {t("rangeLabel")}
        </span>
      </header>

      <p className="text-xs text-muted-foreground">
        {t("descriptionPrefix")}
        <span className="px-1 font-medium text-foreground lowercase">
          {tRoles(roleLabelKey("driver"))}
        </span>
        {t("descriptionMiddle")}
        <span className="px-1 font-medium text-foreground lowercase">
          {tRoles(roleLabelKey("owner"))}
        </span>
        {t("descriptionSuffix")}
      </p>

      <ol className="space-y-2.5">
        {ladder.map((rung) => {
          const pct = (rung.rank / maxRank) * 100;
          const isApex = rung.role === "owner";
          return (
            <li
              key={rung.role}
              className="grid grid-cols-[5.5rem_1fr_2.25rem] items-center gap-3"
            >
              <span className="truncate text-xs uppercase tracking-[0.14em] text-muted-foreground">
                {tRoles(roleLabelKey(rung.role))}
              </span>
              <div className="relative h-2 overflow-hidden rounded-full bg-foreground/10">
                <div
                  className={
                    "absolute inset-y-0 left-0 rounded-full " +
                    (isApex ? "bg-[var(--editorial-accent)]" : "bg-foreground/60")
                  }
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                {rung.rank}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
