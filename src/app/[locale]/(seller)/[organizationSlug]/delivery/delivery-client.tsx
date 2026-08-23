"use client";

import { useState } from "react";
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
  const [zones, setZones] = useState<DeliveryZone[]>(initialSetup.zones);
  const [trucks, setTrucks] = useState<Truck[]>(initialSetup.trucks);
  const [truckZones, setTruckZonesList] = useState<TruckZone[]>(initialSetup.truckZones);
  const [slots, setSlots] = useState<DeliverySlot[]>(initialSetup.slots);
  const [blocks, setBlocks] = useState<ScheduleBlock[]>(initialSetup.blocks);
  const [facility, setFacility] = useState<Facility | null>(logisticsSetup.facility);
  const [bays, setBays] = useState<Bay[]>(logisticsSetup.bays);
  const [ranges, setRanges] = useState<ZonePostcodeRange[]>(logisticsSetup.ranges);

  const canEdit = role === "owner" || role === "org_admin";

  function fail(message: string) {
    toast({ title: "Error", description: message, variant: "destructive" });
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
    toast({ title: editing ? "Zone updated" : "Zone created" });
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
        ? prev.map((t) => (t.id === result.data.id ? result.data : t))
        : [...prev, result.data],
    );
    toast({ title: editing ? "Truck updated" : "Truck created" });
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
    toast({ title: editing ? "Slot updated" : "Slot created" });
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
    toast({ title: "Blocked date added" });
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
      title: archived ? "Archived" : "Restored",
      description: archived ? "Hidden from live views. Nothing was deleted." : undefined,
      action: (
        <ToastAction
          altText="Undo"
          onClick={() => void handleArchive(entity, recordId, !archived)}
        >
          Undo
        </ToastAction>
      ),
    });
  }

  // -- Permanent delete -----------------------------------------------

  async function handleRemove(entity: SetupEntity, recordId: string) {
    if (entity === "zones") {
      const zone = zones.find((z) => z.id === recordId);
      if (!zone || !confirm(`Delete zone "${zone.name}" permanently?`)) return;
      const result = await deleteZone(organizationSlug, zone.id);
      if (!result.ok) return fail(result.message);
      setZones((prev) => prev.filter((z) => z.id !== zone.id));
      setTruckZonesList((prev) => prev.filter((tz) => tz.zone_id !== zone.id));
      toast({ title: "Zone deleted" });
    } else if (entity === "trucks") {
      const truck = trucks.find((t) => t.id === recordId);
      if (!truck || !confirm(`Delete truck "${truck.name}" permanently?`)) return;
      const result = await deleteTruck(organizationSlug, truck.id);
      if (!result.ok) return fail(result.message);
      setTrucks((prev) => prev.filter((t) => t.id !== truck.id));
      setTruckZonesList((prev) => prev.filter((tz) => tz.truck_id !== truck.id));
      setSlots((prev) => prev.filter((s) => s.truck_id !== truck.id));
      setBlocks((prev) => prev.filter((b) => b.truck_id !== truck.id));
      toast({ title: "Truck deleted" });
    } else if (entity === "slots") {
      if (!confirm("Delete this delivery slot permanently?")) return;
      const result = await deleteSlot(organizationSlug, recordId);
      if (!result.ok) return fail(result.message);
      setSlots((prev) => prev.filter((s) => s.id !== recordId));
      toast({ title: "Slot deleted" });
    } else if (entity === "blocks") {
      if (!confirm("Remove this blocked date?")) return;
      const result = await deleteBlock(organizationSlug, recordId);
      if (!result.ok) return fail(result.message);
      setBlocks((prev) => prev.filter((b) => b.id !== recordId));
      toast({ title: "Blocked date removed" });
    }
  }

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
        <h1 className="text-2xl font-bold">Delivery Setup</h1>
        <p className="text-muted-foreground">
          Zones, trucks, weekly slots, and blocked dates for the delivery schedule
        </p>
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
    </div>
  );
}
