import { getTranslations } from "next-intl/server";
import { Separator } from "@/components/ui/separator";

/**
 * Masthead block — sets the editorial tone of the page. Pure server.
 *
 * Intentionally sparse: a kicker, a single monumental line, and a metadata
 * row. Heavy typographic weight does the work of "design".
 */
export async function RolesMasthead({
  organizationName,
  roleCount,
  capabilityCount,
  groupCount,
}: {
  organizationName: string;
  roleCount: number;
  capabilityCount: number;
  groupCount: number;
}) {
  const t = await getTranslations("identity.rolesMasthead");

  return (
    <header className="relative overflow-hidden border-b border-foreground/10 pb-8">
      <div className="flex items-baseline justify-between gap-6">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          {t("kicker", { organizationName })}
        </p>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          {t("issueTag")}
        </p>
      </div>

      <h1
        className="mt-6 font-display text-[clamp(3.5rem,9vw,7rem)] leading-[0.9] tracking-tight"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {t("titleRoles")}{" "}
        <span className="italic text-[var(--editorial-accent)]">&amp;</span>{" "}
        {t("titlePermissions")}
      </h1>

      <p className="mt-4 max-w-2xl text-balance text-base text-muted-foreground">
        {t("description")}
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
        <Stat label={t("statRoles")} value={roleCount} />
        <Stat label={t("statCapabilities")} value={capabilityCount} />
        <Stat label={t("statCategories")} value={groupCount} />
        <Separator
          orientation="vertical"
          className="hidden h-4 sm:block"
        />
        <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          {t("lastRevised", { date: "11 Jul 2026" })}
        </span>
      </div>
    </header>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-2">
      <span
        className="text-3xl leading-none tabular-nums"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {value}
      </span>
      <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
