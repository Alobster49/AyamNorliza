import { getTranslations } from "next-intl/server";
import type { CapabilityMatrixData } from "../lib/capability-matrix";
import { roleLabelKey } from "./role-label";

/**
 * Capability matrix — the editorial centerpiece.
 *
 * Renders as a heatmap:
 * - Y axis: roles, ranked highest-privilege first
 * - X axis: capability groups, with intra-group columns
 * - Cell: filled dot (has capability) or hollow dot (no capability),
 *   tinted with the editorial accent only on the granted side.
 *
 * Server component. No client hooks. Accessible: each cell is a labeled
 * <span> with a full sentence for screen readers.
 */
export async function CapabilityMatrix({ data }: { data: CapabilityMatrixData }) {
  const { rows, groups } = data;
  const totalCapabilities = groups.reduce((s, g) => s + g.capabilities.length, 0);
  const [t, tRoles] = await Promise.all([
    getTranslations("identity.capabilityMatrix"),
    getTranslations("roles"),
  ]);

  return (
    <section
      aria-labelledby="matrix-heading"
      className="border-b border-foreground/10 pb-12"
    >
      <div className="flex items-baseline justify-between">
        <h2
          id="matrix-heading"
          className="font-display text-3xl leading-none"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("heading")}
        </h2>
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
          {t("subheading", { roleCount: rows.length, capCount: totalCapabilities })}
        </p>
      </div>

      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        {t("description")}
      </p>

      <div className="mt-8 overflow-x-auto">
        <table
          className="w-full border-separate border-spacing-0"
          aria-describedby="matrix-heading"
        >
          <caption className="sr-only">
            {t("caption")}
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 w-44 border-b border-foreground/20 bg-background pb-3 pr-4 text-left align-bottom text-xs uppercase tracking-[0.18em] text-muted-foreground"
              >
                {t("roleColumnHeader")}
              </th>
              {groups.map((group) => (
                <th
                  key={group.id}
                  scope="colgroup"
                  colSpan={group.capabilities.length}
                  className="border-b border-foreground/20 px-1 pb-3 text-center align-bottom text-xs uppercase tracking-[0.18em] text-muted-foreground"
                >
                  <span className="block leading-tight">{group.label}</span>
                </th>
              ))}
            </tr>
            <tr>
              <th scope="col" className="pb-3" aria-hidden />
              {groups.flatMap((group) =>
                group.capabilities.map((cap) => (
                  <th
                    key={cap}
                    scope="col"
                    className="px-1 pb-3 align-bottom"
                    title={cap}
                  >
                    <span className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80 [writing-mode:vertical-rl] [text-orientation:mixed]">
                      {cap}
                    </span>
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                key={row.role}
                className="group/row animate-fade-in"
                style={{ animationDelay: `${rowIndex * 30}ms` }}
              >
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-b border-foreground/5 bg-background py-3 pr-4 text-left"
                >
                  <div className="flex items-baseline gap-2">
                    <span
                      className="font-display text-xl leading-none"
                      style={{ fontFamily: "var(--font-display)" }}
                    >
                      {tRoles(roleLabelKey(row.role))}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {row.rank}
                    </span>
                  </div>
                  <span className="mt-1 block text-xs text-muted-foreground tabular-nums">
                    {row.capabilityCount}/{totalCapabilities}
                  </span>
                </th>
                {groups.flatMap((group) =>
                  group.capabilities.map((cap) => {
                    const cell = row.cells[cap];
                    const has = cell?.hasCapability ?? false;
                    return (
                      <td
                        key={cap}
                        className="border-b border-foreground/5 px-1 py-3 text-center"
                      >
                        <span
                          role="img"
                          aria-label={t("cellAriaLabel", {
                            role: tRoles(roleLabelKey(row.role)),
                            hasCapability: has ? "true" : "false",
                            capability: cap,
                          })}
                          className={
                            "inline-block size-3 rounded-full border " +
                            (has
                              ? "border-transparent bg-[var(--editorial-accent)] shadow-[0_0_0_3px_color-mix(in_oklab,var(--editorial-accent)_15%,transparent)]"
                              : "border-foreground/30 bg-transparent")
                          }
                        />
                      </td>
                    );
                  }),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
