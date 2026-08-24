"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { RangePreset } from "../date-range";

const PRESETS: RangePreset[] = ["today", "7d", "30d", "90d"];

export function RangePicker({
  active,
  onSelect,
  disabled,
}: {
  active: RangePreset | "custom";
  onSelect: (preset: RangePreset) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("analytics.range");
  return (
    <div className="flex flex-wrap gap-1">
      {PRESETS.map((preset) => (
        <Button
          key={preset}
          size="sm"
          variant={active === preset ? "default" : "outline"}
          disabled={disabled}
          onClick={() => onSelect(preset)}
        >
          {t(preset)}
        </Button>
      ))}
    </div>
  );
}
