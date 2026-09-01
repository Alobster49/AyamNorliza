"use client";

import { Bell, Check } from "lucide-react";
import { useTranslations } from "next-intl";

const SWATCH = "inline-block size-3.5 rounded-[4px] border";

export function RosterLegend() {
  const t = useTranslations("roster.legend");
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><i className={`${SWATCH} inline-flex items-center justify-center text-foreground/30`}><Check className="size-2.5" /></i>{t("regular")}</span>
      <span className="inline-flex items-center gap-1.5"><i className={SWATCH} style={{ background: "var(--status-cancelled-soft)" }} />{t("leave")}</span>
      <span className="inline-flex items-center gap-1.5"><i className={`${SWATCH} roster-hatch-pending`} />{t("pending")}</span>
      <span className="inline-flex items-center gap-1.5"><i className={SWATCH} style={{ background: "var(--status-pending-soft)" }} />{t("cover")}</span>
      <span className="inline-flex items-center gap-1.5"><i className={`${SWATCH} border-2 border-dashed border-destructive`} />{t("gap")}</span>
      <span className="inline-flex items-center gap-1.5"><i className={`${SWATCH} roster-hatch-off`} />{t("off")}</span>
    </div>
  );
}

export function AlertPill({ gaps, risks }: { gaps: number; risks: number }) {
  const t = useTranslations("roster.alert");
  if (gaps === 0 && risks === 0) return null;
  return (
    <span className="inline-flex h-8 items-center gap-1.5 rounded-2xl border border-destructive/40 px-3 text-sm font-medium">
      <Bell className="size-4 text-destructive" />
      <span className="text-destructive">{t("gaps", { count: gaps })}</span>
      {risks > 0 ? (
        <>
          <span className="text-muted-foreground">·</span>
          <span style={{ color: "var(--status-confirmed-text)" }}>{t("risks", { count: risks })}</span>
        </>
      ) : null}
    </span>
  );
}
