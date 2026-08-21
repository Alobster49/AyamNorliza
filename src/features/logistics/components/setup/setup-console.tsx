"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, MoreHorizontal, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SetupEntity, SetupIssue, SetupSnapshot } from "../../lib/setup-model";
import { findIssues, searchSetup } from "../../lib/setup-model";
import { ENTITY_LABELS, ENTITY_ORDER, EntityRail } from "./entity-rail";
import { ReadinessPanel } from "./readiness-panel";
import { RecordList, type ListRow } from "./record-list";
import {
  BlockFields,
  SlotFields,
  TruckFields,
  WEEKDAY_LABELS,
  ZoneFields,
} from "./detail-forms";

/** Entities that render one of the pre-existing panels instead of a list + form. */
const PANEL_ENTITIES = ["factory", "bays", "postcodes"] as const;
type PanelEntity = (typeof PANEL_ENTITIES)[number];

function isPanelEntity(entity: SetupEntity): entity is PanelEntity {
  return (PANEL_ENTITIES as readonly SetupEntity[]).includes(entity);
}

export type ConsoleHandlers = {
  /** Resolves to the saved record's id, or null when the save failed. */
  submit: (
    entity: SetupEntity,
    recordId: string | null,
    form: FormData,
  ) => Promise<string | null>;
  archive: (entity: SetupEntity, recordId: string, archived: boolean) => Promise<void>;
  remove: (entity: SetupEntity, recordId: string) => Promise<void>;
  toggleTruckZone: (truckId: string, zoneId: string, checked: boolean) => Promise<void>;
};

type Selection = {
  entity: SetupEntity;
  recordId: string | null;
  creating: boolean;
  /** Below lg the panes are a drill-down; this is which half is on screen. */
  opened: boolean;
};

const ADD_LABELS: Record<SetupEntity, string> = {
  zones: "Add zone",
  trucks: "Add truck",
  slots: "Add slot",
  blocks: "Block a date",
  factory: "",
  bays: "",
  postcodes: "",
};

const EMPTY_MESSAGES: Record<SetupEntity, string> = {
  zones: "No zones yet",
  trucks: "No trucks yet",
  slots: "No slots yet",
  blocks: "No blocked dates",
  factory: "",
  bays: "",
  postcodes: "",
};

function truckName(snapshot: SetupSnapshot, truckId: string | null): string {
  if (truckId === null) return "All trucks";
  return snapshot.trucks.find((t) => t.id === truckId)?.name ?? "Unknown truck";
}

function rowsFor(
  entity: SetupEntity,
  snapshot: SetupSnapshot,
  issues: SetupIssue[],
  truckFilter: string | null,
): ListRow[] {
  const flagged = new Set(
    issues.filter((i) => i.target.recordId !== null).map((i) => i.target.recordId),
  );
  const badge = (id: string) =>
    flagged.has(id) ? ({ text: "needs setup", tone: "warning" } as const) : undefined;

  switch (entity) {
    case "zones":
      return snapshot.zones.map((z) => ({
        id: z.id,
        label: z.name,
        secondary: `Display order ${z.display_order}`,
        badge: badge(z.id),
        archived: !z.is_active,
      }));
    case "trucks":
      return snapshot.trucks.map((t) => ({
        id: t.id,
        label: t.name,
        secondary: t.capacity_kg === null ? t.code : `${t.code} · ${t.capacity_kg} kg`,
        badge: badge(t.id),
        archived: !t.is_active,
      }));
    case "slots":
      return snapshot.slots
        .filter((s) => truckFilter === null || s.truck_id === truckFilter)
        .sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time))
        .map((s) => ({
          id: s.id,
          label: `${WEEKDAY_LABELS[s.weekday]} ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`,
          secondary: `${truckName(snapshot, s.truck_id)} · max ${s.max_orders ?? "unlimited"}`,
          archived: !s.is_active,
        }));
    case "blocks":
      return snapshot.blocks.map((b) => ({
        id: b.id,
        label: b.block_date,
        secondary: `${truckName(snapshot, b.truck_id)} · ${b.reason ?? "no reason given"}`,
      }));
    default:
      return [];
  }
}

export function SetupConsole({
  snapshot,
  canEdit,
  handlers,
  panels,
}: {
  snapshot: SetupSnapshot;
  canEdit: boolean;
  handlers: ConsoleHandlers;
  panels: Record<PanelEntity, React.ReactNode>;
}) {
  const [selection, setSelection] = useState<Selection>({
    entity: "zones",
    recordId: null,
    creating: false,
    opened: false,
  });
  const [query, setQuery] = useState("");
  const [truckFilter, setTruckFilter] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const issues = useMemo(() => findIssues(snapshot), [snapshot]);
  const hits = useMemo(() => searchSetup(snapshot, query), [snapshot, query]);

  const counts = useMemo(() => {
    const map = {} as Record<SetupEntity, number>;
    map.zones = snapshot.zones.length;
    map.trucks = snapshot.trucks.length;
    map.slots = snapshot.slots.length;
    map.blocks = snapshot.blocks.length;
    map.factory = snapshot.facility ? 1 : 0;
    map.bays = snapshot.bays.length;
    map.postcodes = snapshot.ranges.length;
    return map;
  }, [snapshot]);

  const issueCounts = useMemo(() => {
    const map = {} as Record<SetupEntity, number>;
    for (const entity of ENTITY_ORDER) map[entity] = 0;
    for (const issue of issues) map[issue.target.entity] += 1;
    return map;
  }, [issues]);

  const activeZones = snapshot.zones.filter((z) => z.is_active);
  const activeTrucks = snapshot.trucks.filter((t) => t.is_active);
  const rows = rowsFor(selection.entity, snapshot, issues, truckFilter);
  const detailOpen = selection.opened;

  function selectEntity(entity: SetupEntity) {
    setTruckFilter(null);
    // The three panel entities have no list of their own, so choosing one in
    // the rail goes straight to its panel.
    setSelection({ entity, recordId: null, creating: false, opened: isPanelEntity(entity) });
  }

  function handleFix(target: { entity: SetupEntity; recordId: string | null }) {
    setQuery("");
    if (target.entity === "slots") {
      // Slot issues point at the truck that owns them, not at a slot row.
      setTruckFilter(target.recordId);
      setSelection({ entity: "slots", recordId: null, creating: false, opened: false });
      return;
    }
    setTruckFilter(null);
    setSelection({
      entity: target.entity,
      recordId: target.recordId,
      creating: false,
      opened: target.recordId !== null || isPanelEntity(target.entity),
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const savedId = await handlers.submit(
        selection.entity,
        selection.recordId,
        form,
      );
      if (savedId !== null) {
        setSelection((prev) => ({ ...prev, recordId: savedId, creating: false, opened: true }));
      }
    } finally {
      setSaving(false);
    }
  }

  const selectedZone =
    selection.entity === "zones" && selection.recordId !== null
      ? snapshot.zones.find((z) => z.id === selection.recordId)
      : undefined;
  const selectedTruck =
    selection.entity === "trucks" && selection.recordId !== null
      ? snapshot.trucks.find((t) => t.id === selection.recordId)
      : undefined;
  const selectedSlot =
    selection.entity === "slots" && selection.recordId !== null
      ? snapshot.slots.find((s) => s.id === selection.recordId)
      : undefined;

  const archivedRecord =
    selectedZone !== undefined
      ? !selectedZone.is_active
      : selectedTruck !== undefined
        ? !selectedTruck.is_active
        : selectedSlot !== undefined
          ? !selectedSlot.is_active
          : false;

  const canArchive =
    selection.recordId !== null && selection.entity !== "blocks" && !isPanelEntity(selection.entity);

  function renderFields() {
    switch (selection.entity) {
      case "zones":
        return <ZoneFields zone={selectedZone} />;
      case "trucks":
        return <TruckFields truck={selectedTruck} bays={snapshot.bays} />;
      case "slots":
        return (
          <SlotFields
            slot={selectedSlot}
            trucks={activeTrucks}
            defaultTruckId={truckFilter ?? activeTrucks[0]?.id ?? ""}
          />
        );
      case "blocks":
        return <BlockFields trucks={activeTrucks} />;
      default:
        return null;
    }
  }

  function renderDetail() {
    if (isPanelEntity(selection.entity)) {
      return <div className="p-4">{panels[selection.entity]}</div>;
    }

    if (!detailOpen) {
      return (
        <div className="hidden h-full items-center justify-center p-8 text-center text-sm text-muted-foreground lg:flex">
          Pick a record on the left, or add a new one.
        </div>
      );
    }

    if (selection.entity === "slots" && activeTrucks.length === 0) {
      return (
        <div className="p-6 text-sm text-muted-foreground">
          Add a truck before configuring slots.
        </div>
      );
    }

    return (
      <form
        key={`${selection.entity}:${selection.recordId ?? "new"}`}
        onSubmit={handleSubmit}
        className="flex h-full flex-col"
      >
        <fieldset disabled={!canEdit} className="flex-1 space-y-6 p-4">
          {renderFields()}

          {selection.entity === "trucks" && selection.recordId !== null ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Zones served</p>
              <p className="text-xs text-muted-foreground">Saved automatically.</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {activeZones.length === 0 ? (
                  <span className="text-sm text-muted-foreground">No zones yet.</span>
                ) : (
                  activeZones.map((zone) => {
                    const checked = snapshot.truckZones.some(
                      (tz) =>
                        tz.truck_id === selection.recordId && tz.zone_id === zone.id,
                    );
                    return (
                      <label
                        key={zone.id}
                        className="flex min-h-11 items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={checked}
                          onChange={(e) => {
                            if (selection.recordId === null) return;
                            void handlers.toggleTruckZone(
                              selection.recordId,
                              zone.id,
                              e.target.checked,
                            );
                          }}
                        />
                        {zone.name}
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          ) : null}
        </fieldset>

        {canEdit ? (
          <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t bg-background p-3">
            <span className="flex-1 text-xs text-muted-foreground">
              {selection.creating || selection.recordId === null
                ? `New ${ENTITY_LABELS[selection.entity].toLowerCase().replace(/s$/, "")}`
                : archivedRecord
                  ? "Archived — hidden from live views"
                  : ""}
            </span>
            {canArchive ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 sm:min-h-9"
                onClick={() => {
                  if (selection.recordId === null) return;
                  void handlers.archive(
                    selection.entity,
                    selection.recordId,
                    !archivedRecord,
                  );
                }}
              >
                {archivedRecord ? "Restore" : "Archive"}
              </Button>
            ) : null}
            {selection.recordId !== null ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-11 sm:min-h-9"
                    aria-label="More actions"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-destructive"
                    onSelect={() => {
                      if (selection.recordId === null) return;
                      void handlers
                        .remove(selection.entity, selection.recordId)
                        .then(() =>
                          setSelection((prev) => ({
                            ...prev,
                            recordId: null,
                            creating: false,
                            opened: false,
                          })),
                        );
                    }}
                  >
                    {selection.entity === "blocks" ? "Remove" : "Delete permanently"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <Button type="submit" size="sm" className="min-h-11 sm:min-h-9" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        ) : null}
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <ReadinessPanel issues={issues} onFix={handleFix} />

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search trucks, zones, slots — or type a postcode"
          className="pl-9"
          aria-label="Search delivery setup"
        />
      </div>

      {query.trim() !== "" ? (
        <div className="rounded-lg border">
          {hits.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Nothing matches “{query.trim()}”.
            </p>
          ) : (
            <ul className="divide-y">
              {hits.map((hit) => (
                <li key={`${hit.entity}:${hit.recordId}:${hit.label}`}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full flex-col items-start px-4 py-2 text-left hover:bg-muted/50"
                    onClick={() => {
                      handleFix({ entity: hit.entity, recordId: hit.recordId });
                      setQuery("");
                    }}
                  >
                    <span className="text-sm font-medium">{hit.label}</span>
                    <span className="text-xs text-muted-foreground">{hit.context}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 overflow-hidden rounded-lg border lg:grid-cols-[190px_minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className={cn("bg-muted/40 lg:border-r", detailOpen && "hidden lg:block")}>
            <EntityRail
              selected={selection.entity}
              counts={counts}
              issueCounts={issueCounts}
              onSelect={selectEntity}
            />
          </div>

          {isPanelEntity(selection.entity) ? null : (
            <div className={cn("lg:border-r", detailOpen && "hidden lg:block")}>
              {truckFilter !== null ? (
                <div className="flex items-center justify-between gap-2 border-b px-4 py-2 text-xs">
                  <span className="text-muted-foreground">
                    Showing {truckName(snapshot, truckFilter)} only
                  </span>
                  <button
                    type="button"
                    className="font-medium text-primary"
                    onClick={() => setTruckFilter(null)}
                  >
                    Show all
                  </button>
                </div>
              ) : null}
              <RecordList
                rows={rows}
                selectedId={selection.recordId}
                emptyMessage={EMPTY_MESSAGES[selection.entity]}
                addLabel={ADD_LABELS[selection.entity]}
                canEdit={canEdit}
                onSelect={(id) =>
                  setSelection({
                    entity: selection.entity,
                    recordId: id,
                    creating: false,
                    opened: true,
                  })
                }
                onAdd={() =>
                  setSelection({
                    entity: selection.entity,
                    recordId: null,
                    creating: true,
                    opened: true,
                  })
                }
              />
            </div>
          )}

          <div
            className={cn(
              "min-w-0",
              isPanelEntity(selection.entity) && "lg:col-span-2",
              !detailOpen && "hidden lg:block",
            )}
          >
            {detailOpen ? (
              <button
                type="button"
                className="flex min-h-11 w-full items-center gap-1 border-b px-3 text-sm font-medium text-primary lg:hidden"
                onClick={() =>
                  setSelection({
                    entity: selection.entity,
                    recordId: null,
                    creating: false,
                    opened: false,
                  })
                }
              >
                <ChevronLeft className="h-4 w-4" />
                {ENTITY_LABELS[selection.entity]}
              </button>
            ) : null}
            {renderDetail()}
          </div>
        </div>
      )}
    </div>
  );
}
