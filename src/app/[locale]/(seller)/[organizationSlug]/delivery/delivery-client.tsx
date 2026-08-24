"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  createBlock,
  createSlot,
  createTruck,
  createZone,
  deleteBlock,
  deleteSlot,
  deleteTruck,
  deleteZone,
  setTruckZones,
  updateSlot,
  updateTruck,
  updateZone,
} from "@/features/orders/server/schedule-actions";
import type {
  DeliverySetup,
  DeliverySlot,
  DeliveryZone,
  ScheduleBlock,
  Truck,
  TruckZone,
} from "@/features/orders/types";
import type { LogisticsSetup } from "@/features/logistics/server/facility-actions";
import type { Bay, Facility, ZonePostcodeRange } from "@/features/logistics/types";
import type { SetupEntity, SetupSnapshot } from "@/features/logistics/lib/setup-model";
import { BaysPanel } from "@/features/logistics/components/bays-panel";
import { FacilityPanel } from "@/features/logistics/components/facility-panel";
import { PostcodeRangesPanel } from "@/features/logistics/components/postcode-ranges-panel";
import {
  SetupConsole,
  type ConsoleHandlers,
} from "@/features/logistics/components/setup/setup-console";
import { ToastAction } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useToast } from "@/hooks/use-toast";

type DeliveryClientProps = {
  organizationSlug: string;
  initialSetup: DeliverySetup;
  logisticsSetup: LogisticsSetup;
  role: string;
};

export function DeliveryClient({
  organizationSlug,
  initialSetup,
  logisticsSetup,
  role,
}: DeliveryClientProps) {
  const { toast } = useToast();
  const t = useTranslations("logistics.setup.toasts");
  const tDelivery = useTranslations("logistics.delivery");
  const tLogistics = useTranslations("logistics");
  const [zones, setZones] = useState<DeliveryZone[]>(initialSetup.zones);
  const [trucks, setTrucks] = useState<Truck[]>(initialSetup.trucks);
  const [truckZones, setTruckZonesList] = useState<TruckZone[]>(initialSetup.truckZones);
  const [slots, setSlots] = useState<DeliverySlot[]>(initialSetup.slots);
  const [blocks, setBlocks] = useState<ScheduleBlock[]>(initialSetup.blocks);
  const [facility, setFacility] = useState<Facility | null>(logisticsSetup.facility);
  const [bays, setBays] = useState<Bay[]>(logisticsSetup.bays);
  const [ranges, setRanges] = useState<ZonePostcodeRange[]>(logisticsSetup.ranges);
  // Delete-confirm state: target and visibility kept separate so the closing
  // dialog retains its text through the exit animation.
  const [removeTarget, setRemoveTarget] = useState<{
    entity: SetupEntity;
    recordId: string;
    name: string;
  } | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);

  const canEdit = role === "owner" || role === "org_admin";

  function fail(message: string) {
    toast({ title: tLogistics("error"), description: message, variant: "destructive" });
  }

  // -- Saving ---------------------------------------------------------
  // One entry point per entity. The console owns the form element and hands
  // over its FormData, so these never see a DOM event.

  async function saveZone(recordId: string | null, form: FormData) {
    const editing = recordId ? zones.find((z) => z.id === recordId) : undefined;
    const input = {
      name: String(form.get("name") ?? ""),
      displayOrder: Number(form.get("displayOrder") ?? 0),
      isActive: form.get("isActive") === "on",
    };
    const result = editing
      ? await updateZone(organizationSlug, editing.id, input)
      : await createZone(organizationSlug, input);
    if (!result.ok) {
      fail(result.message);
      return null;
    }
    setZones((prev) =>
      editing
        ? prev.map((z) => (z.id === result.data.id ? result.data : z))
        : [...prev, result.data],
    );
    toast({ title: editing ? t("zoneUpdated") : t("zoneCreated") });
    return result.data.id;
  }

  async function saveTruck(recordId: string | null, form: FormData) {
    const editing = recordId ? trucks.find((t) => t.id === recordId) : undefined;
    const capacityRaw = String(form.get("capacityKg") ?? "").trim();
    const bayRaw = String(form.get("bayId") ?? "");
    const input = {
      name: String(form.get("name") ?? ""),
      code: String(form.get("code") ?? ""),
      isActive: form.get("isActive") === "on",
      capacityKg: capacityRaw === "" ? null : Number(capacityRaw),
      bayId: bayRaw === "" ? null : bayRaw,
    };
    const result = editing
      ? await updateTruck(organizationSlug, editing.id, input)
      : await createTruck(organizationSlug, input);
    if (!result.ok) {
      fail(result.message);
      return null;
    }
    setTrucks((prev) =>
      editing
        ? prev.map((tr) => (tr.id === result.data.id ? result.data : tr))
        : [...prev, result.data],
    );
    toast({ title: editing ? t("truckUpdated") : t("truckCreated") });
    return result.data.id;
  }

  async function saveSlot(recordId: string | null, form: FormData) {
    const editing = recordId ? slots.find((s) => s.id === recordId) : undefined;
    const maxOrdersRaw = String(form.get("maxOrders") ?? "").trim();
    const input = {
      truckId: String(form.get("truckId") ?? ""),
      weekday: Number(form.get("weekday")),
      startTime: String(form.get("startTime") ?? ""),
      endTime: String(form.get("endTime") ?? ""),
      maxOrders: maxOrdersRaw === "" ? null : Number(maxOrdersRaw),
      isActive: form.get("isActive") === "on",
    };
    const result = editing
      ? await updateSlot(organizationSlug, editing.id, input)
      : await createSlot(organizationSlug, input);
    if (!result.ok) {
      fail(result.message);
      return null;
    }
    setSlots((prev) =>
      editing
        ? prev.map((s) => (s.id === result.data.id ? result.data : s))
        : [...prev, result.data],
    );
    toast({ title: editing ? t("slotUpdated") : t("slotCreated") });
    return result.data.id;
  }

  async function saveBlock(form: FormData) {
    const truckId = String(form.get("truckId") ?? "all");
    const reason = String(form.get("reason") ?? "").trim();
    const input = {
      blockDate: String(form.get("blockDate") ?? ""),
      truckId: truckId === "all" ? null : truckId,
      ...(reason === "" ? {} : { reason }),
    };
    const result = await createBlock(organizationSlug, input);
    if (!result.ok) {
      fail(result.message);
      return null;
    }
    setBlocks((prev) => [...prev, result.data]);
    toast({ title: t("blockAdded") });
    return result.data.id;
  }

  // -- Archive / restore ----------------------------------------------
  // Retiring a record flips is_active through the existing update action, so
  // history keeps pointing at a row that still exists — same as Products.

  async function handleArchive(entity: SetupEntity, recordId: string, archived: boolean) {
    if (entity === "zones") {
      const zone = zones.find((z) => z.id === recordId);
      if (!zone) return;
      const result = await updateZone(organizationSlug, zone.id, {
        name: zone.name,
        displayOrder: zone.display_order,
        isActive: !archived,
      });
      if (!result.ok) return fail(result.message);
      setZones((prev) => prev.map((z) => (z.id === result.data.id ? result.data : z)));
    } else if (entity === "trucks") {
      const truck = trucks.find((t) => t.id === recordId);
      if (!truck) return;
      const result = await updateTruck(organizationSlug, truck.id, {
        name: truck.name,
        code: truck.code,
        isActive: !archived,
        capacityKg: truck.capacity_kg,
        bayId: truck.bay_id,
      });
      if (!result.ok) return fail(result.message);
      setTrucks((prev) => prev.map((t) => (t.id === result.data.id ? result.data : t)));
    } else if (entity === "slots") {
      const slot = slots.find((s) => s.id === recordId);
      if (!slot) return;
      const result = await updateSlot(organizationSlug, slot.id, {
        truckId: slot.truck_id,
        weekday: slot.weekday,
        // The row holds HH:MM:SS but SlotInputSchema only accepts HH:MM.
        startTime: slot.start_time.slice(0, 5),
        endTime: slot.end_time.slice(0, 5),
        maxOrders: slot.max_orders,
        isActive: !archived,
      });
      if (!result.ok) return fail(result.message);
      setSlots((prev) => prev.map((s) => (s.id === result.data.id ? result.data : s)));
    } else {
      return;
    }

    toast({
      title: archived ? t("archived") : t("restored"),
      description: archived ? t("archivedDescription") : undefined,
      action: (
        <ToastAction
          altText={t("undo")}
          onClick={() => void handleArchive(entity, recordId, !archived)}
        >
          {t("undo")}
        </ToastAction>
      ),
    });
  }

  // -- Permanent delete -----------------------------------------------

  /**
   * Opens the confirm dialog. The returned promise resolves only after the
   * user confirms AND the delete succeeds — the setup console clears its
   * editor selection on resolution, which must not happen on cancel or
   * failure (the record still exists then).
   */
  const removeResolver = useRef<(() => void) | null>(null);
  function handleRemove(entity: SetupEntity, recordId: string): Promise<void> {
    if (entity === "zones") {
      const zone = zones.find((z) => z.id === recordId);
      if (!zone) return Promise.resolve();
      setRemoveTarget({ entity, recordId, name: zone.name });
    } else if (entity === "trucks") {
      const truck = trucks.find((tr) => tr.id === recordId);
      if (!truck) return Promise.resolve();
      setRemoveTarget({ entity, recordId, name: truck.name });
    } else if (entity === "slots" || entity === "blocks") {
      setRemoveTarget({ entity, recordId, name: "" });
    } else {
      return Promise.resolve();
    }
    setRemoveOpen(true);
    return new Promise<void>((resolve) => {
      removeResolver.current = resolve;
    });
  }

  async function performRemove(entity: SetupEntity, recordId: string): Promise<boolean> {
    if (entity === "zones") {
      const result = await deleteZone(organizationSlug, recordId);
      if (!result.ok) {
        fail(result.message);
        return false;
      }
      setZones((prev) => prev.filter((z) => z.id !== recordId));
      setTruckZonesList((prev) => prev.filter((tz) => tz.zone_id !== recordId));
      toast({ title: t("zoneDeleted") });
    } else if (entity === "trucks") {
      const result = await deleteTruck(organizationSlug, recordId);
      if (!result.ok) {
        fail(result.message);
        return false;
      }
      setTrucks((prev) => prev.filter((tr) => tr.id !== recordId));
      setTruckZonesList((prev) => prev.filter((tz) => tz.truck_id !== recordId));
      setSlots((prev) => prev.filter((s) => s.truck_id !== recordId));
      setBlocks((prev) => prev.filter((b) => b.truck_id !== recordId));
      toast({ title: t("truckDeleted") });
    } else if (entity === "slots") {
      const result = await deleteSlot(organizationSlug, recordId);
      if (!result.ok) {
        fail(result.message);
        return false;
      }
      setSlots((prev) => prev.filter((s) => s.id !== recordId));
      toast({ title: t("slotDeleted") });
    } else if (entity === "blocks") {
      const result = await deleteBlock(organizationSlug, recordId);
      if (!result.ok) {
        fail(result.message);
        return false;
      }
      setBlocks((prev) => prev.filter((b) => b.id !== recordId));
      toast({ title: t("blockRemoved") });
    }
    return true;
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    const ok = await performRemove(removeTarget.entity, removeTarget.recordId);
    if (ok) {
      removeResolver.current?.();
    }
    removeResolver.current = null;
  }

  const removeContent =
    removeTarget?.entity === "zones"
      ? {
          title: t("deleteZoneTitle"),
          description: t("confirmDeleteZone", { name: removeTarget.name }),
          confirmLabel: t("confirmDelete"),
        }
      : removeTarget?.entity === "trucks"
        ? {
            title: t("deleteTruckTitle"),
            description: t("confirmDeleteTruck", { name: removeTarget.name }),
            confirmLabel: t("confirmDelete"),
          }
        : removeTarget?.entity === "slots"
          ? {
              title: t("deleteSlotTitle"),
              description: t("confirmDeleteSlot"),
              confirmLabel: t("confirmDelete"),
            }
          : removeTarget?.entity === "blocks"
            ? {
                title: t("removeBlockTitle"),
                description: t("confirmRemoveBlock"),
                confirmLabel: t("confirmRemove"),
              }
            : null;

  async function handleToggleTruckZone(truckId: string, zoneId: string, checked: boolean) {
    const truck = trucks.find((t) => t.id === truckId);
    if (!truck) return;
    const currentZoneIds = truckZones
      .filter((tz) => tz.truck_id === truckId)
      .map((tz) => tz.zone_id);
    const nextZoneIds = checked
      ? [...currentZoneIds, zoneId]
      : currentZoneIds.filter((id) => id !== zoneId);
    const result = await setTruckZones(organizationSlug, truckId, nextZoneIds);
    if (!result.ok) {
      fail(result.message);
      return;
    }
    setTruckZonesList((prev) => [
      ...prev.filter((tz) => tz.truck_id !== truckId),
      ...nextZoneIds.map((id) => ({
        truck_id: truckId,
        zone_id: id,
        organization_id: truck.organization_id,
      })),
    ]);
  }

  // -- Facility / bays / postcode ranges -------------------------------

  function handleFacilitySaved(saved: Facility) {
    setFacility(saved);
  }

  function handleBayCreated(bay: Bay) {
    setBays((prev) => [...prev, bay]);
  }

  function handleBayDeleted(bayId: string) {
    setBays((prev) => prev.filter((b) => b.id !== bayId));
  }

  function handleTruckBayChanged(truckId: string, bayId: string | null) {
    setTrucks((prev) => prev.map((t) => (t.id === truckId ? { ...t, bay_id: bayId } : t)));
  }

  function handleRangeAdded(range: ZonePostcodeRange) {
    setRanges((prev) => [...prev, range]);
  }

  function handleRangeDeleted(rangeId: string) {
    setRanges((prev) => prev.filter((r) => r.id !== rangeId));
  }

  const snapshot: SetupSnapshot = {
    zones,
    trucks,
    truckZones,
    slots,
    blocks,
    facility,
    bays,
    ranges,
  };

  const handlers: ConsoleHandlers = {
    submit: async (entity, recordId, form) => {
      if (entity === "zones") return saveZone(recordId, form);
      if (entity === "trucks") return saveTruck(recordId, form);
      if (entity === "slots") return saveSlot(recordId, form);
      if (entity === "blocks") return saveBlock(form);
      return null;
    },
    archive: handleArchive,
    remove: handleRemove,
    toggleTruckZone: handleToggleTruckZone,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{tDelivery("title")}</h1>
        <p className="text-muted-foreground">{tDelivery("subtitle")}</p>
      </div>

      <SetupConsole
        snapshot={snapshot}
        canEdit={canEdit}
        handlers={handlers}
        panels={{
          factory: (
            <FacilityPanel
              organizationSlug={organizationSlug}
              facility={facility}
              canEdit={canEdit}
              onSaved={handleFacilitySaved}
            />
          ),
          bays: (
            <BaysPanel
              organizationSlug={organizationSlug}
              facilityId={facility?.id ?? null}
              bays={bays}
              trucks={trucks}
              onBayCreated={handleBayCreated}
              onBayDeleted={handleBayDeleted}
              onTruckBayChanged={handleTruckBayChanged}
            />
          ),
          postcodes: (
            <PostcodeRangesPanel
              organizationSlug={organizationSlug}
              zones={zones}
              ranges={ranges}
              onRangeAdded={handleRangeAdded}
              onRangeDeleted={handleRangeDeleted}
            />
          ),
        }}
      />

      <ConfirmDialog
        open={removeOpen}
        onOpenChange={(next) => {
          if (!next) {
            setRemoveOpen(false);
            // Cancelled: leave the console's promise unresolved so its
            // editor selection stays on the still-existing record.
            removeResolver.current = null;
          }
        }}
        title={removeContent?.title ?? ""}
        description={removeContent?.description ?? ""}
        confirmLabel={removeContent?.confirmLabel ?? ""}
        onConfirm={confirmRemove}
      />
    </div>
  );
}
