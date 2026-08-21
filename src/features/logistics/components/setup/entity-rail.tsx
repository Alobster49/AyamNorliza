"use client";

import { cn } from "@/lib/utils";
import type { SetupEntity } from "../../lib/setup-model";

export const ENTITY_LABELS: Record<SetupEntity, string> = {
  zones: "Zones",
  trucks: "Trucks",
  slots: "Slots",
  blocks: "Blocked dates",
  factory: "Factory",
  bays: "Bays",
  postcodes: "Zone postcodes",
};

export const ENTITY_ORDER: SetupEntity[] = [
  "zones",
  "trucks",
  "slots",
  "blocks",
  "factory",
  "bays",
  "postcodes",
];

export function EntityRail({
  selected,
  counts,
  issueCounts,
  onSelect,
}: {
  selected: SetupEntity;
  counts: Record<SetupEntity, number>;
  issueCounts: Record<SetupEntity, number>;
  onSelect: (entity: SetupEntity) => void;
}) {
  return (
    <nav
      aria-label="Setup sections"
      className="flex gap-1 overflow-x-auto p-2 lg:flex-col lg:overflow-visible"
    >
      {ENTITY_ORDER.map((entity) => {
        const isSelected = entity === selected;
        const issues = issueCounts[entity];
        return (
          <button
            key={entity}
            type="button"
            aria-current={isSelected ? "page" : undefined}
            onClick={() => onSelect(entity)}
            className={cn(
              "flex min-h-11 shrink-0 items-center justify-between gap-2 rounded-md px-3 text-sm lg:w-full",
              isSelected
                ? "bg-background font-semibold shadow-sm"
                : "text-muted-foreground hover:bg-background/60",
            )}
          >
            <span className="whitespace-nowrap">{ENTITY_LABELS[entity]}</span>
            <span className="flex items-center gap-1.5">
              {issues > 0 ? (
                <span
                  aria-label={`${issues} issues`}
                  className="h-1.5 w-1.5 rounded-full bg-amber-500"
                />
              ) : null}
              <span className="text-xs tabular-nums text-muted-foreground">
                {counts[entity]}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
