"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rangeLengthDays, type RangePreset } from "../date-range";

const PRESETS: RangePreset[] = ["today", "7d", "30d", "90d"];
// Mirrors the get_dashboard_sales RPC guard (supabase/migrations/20260824000001_dashboard_sales_rpc.sql).
const MAX_CUSTOM_RANGE_DAYS = 400;

export function RangePicker({
  active,
  range,
  onSelect,
  onCustom,
  disabled,
}: {
  active: RangePreset | "custom";
  range: { from: string; to: string };
  onSelect: (preset: RangePreset) => void;
  onCustom: (range: { from: string; to: string }) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("analytics.range");
  const [editing, setEditing] = useState(active === "custom");
  const [draft, setDraft] = useState(range);

  function selectPreset(preset: RangePreset) {
    setEditing(false);
    onSelect(preset);
  }

  function openCustom() {
    setDraft(range);
    setEditing(true);
  }

  const invalid =
    !draft.from ||
    !draft.to ||
    draft.from > draft.to ||
    rangeLengthDays(draft.from, draft.to) > MAX_CUSTOM_RANGE_DAYS;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {PRESETS.map((preset) => (
        <Button
          key={preset}
          size="sm"
          variant={active === preset ? "default" : "outline"}
          disabled={disabled}
          onClick={() => selectPreset(preset)}
        >
          {t(preset)}
        </Button>
      ))}
      <Button
        size="sm"
        variant={active === "custom" ? "default" : "outline"}
        disabled={disabled}
        onClick={openCustom}
      >
        {t("custom")}
      </Button>
      {editing && (
        <div className="flex flex-wrap items-center gap-1">
          <Input
            type="date"
            aria-label={t("from")}
            value={draft.from}
            disabled={disabled}
            onChange={(e) => setDraft((prev) => ({ ...prev, from: e.target.value }))}
            className="w-auto"
          />
          <Input
            type="date"
            aria-label={t("to")}
            value={draft.to}
            disabled={disabled}
            onChange={(e) => setDraft((prev) => ({ ...prev, to: e.target.value }))}
            className="w-auto"
          />
          <Button size="sm" disabled={disabled || invalid} onClick={() => onCustom(draft)}>
            {t("apply")}
          </Button>
        </div>
      )}
    </div>
  );
}
