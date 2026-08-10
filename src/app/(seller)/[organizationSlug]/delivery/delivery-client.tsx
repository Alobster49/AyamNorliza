"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

type ZoneDialogState = { zone?: DeliveryZone } | null;
type TruckDialogState = { truck?: Truck } | null;
type SlotDialogState = { truckId: string; slot?: DeliverySlot } | null;

type DeliveryClientProps = {
  organizationSlug: string;
  initialSetup: DeliverySetup;
};

export function DeliveryClient({ organizationSlug, initialSetup }: DeliveryClientProps) {
  const { toast } = useToast();
  const [zones, setZones] = useState<DeliveryZone[]>(initialSetup.zones);
  const [trucks, setTrucks] = useState<Truck[]>(initialSetup.trucks);
  const [truckZones, setTruckZonesList] = useState<TruckZone[]>(initialSetup.truckZones);
  const [slots, setSlots] = useState<DeliverySlot[]>(initialSetup.slots);
  const [blocks, setBlocks] = useState<ScheduleBlock[]>(initialSetup.blocks);

  const [zoneDialog, setZoneDialog] = useState<ZoneDialogState>(null);
  const [truckDialog, setTruckDialog] = useState<TruckDialogState>(null);
  const [slotDialog, setSlotDialog] = useState<SlotDialogState>(null);
  const [blockForm, setBlockForm] = useState({ blockDate: "", truckId: "all", reason: "" });

  function fail(message: string) {
    toast({ title: "Error", description: message, variant: "destructive" });
  }

  // -- Zones ----------------------------------------------------------

  async function handleZoneSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const editing = zoneDialog?.zone;
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
      return;
    }
    setZones((prev) =>
      editing
        ? prev.map((z) => (z.id === result.data.id ? result.data : z))
        : [...prev, result.data],
    );
    setZoneDialog(null);
    toast({ title: editing ? "Zone updated" : "Zone created" });
  }

  async function handleDeleteZone(zone: DeliveryZone) {
    if (!confirm(`Delete zone "${zone.name}"?`)) return;
    const result = await deleteZone(organizationSlug, zone.id);
    if (!result.ok) {
      fail(result.message);
      return;
    }
    setZones((prev) => prev.filter((z) => z.id !== zone.id));
    setTruckZonesList((prev) => prev.filter((tz) => tz.zone_id !== zone.id));
    toast({ title: "Zone deleted" });
  }

  // -- Trucks -----------------------------------------------------------

  async function handleTruckSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const editing = truckDialog?.truck;
    const input = {
      name: String(form.get("name") ?? ""),
      code: String(form.get("code") ?? ""),
      isActive: form.get("isActive") === "on",
    };
    const result = editing
      ? await updateTruck(organizationSlug, editing.id, input)
      : await createTruck(organizationSlug, input);
    if (!result.ok) {
      fail(result.message);
      return;
    }
    setTrucks((prev) =>
      editing
        ? prev.map((t) => (t.id === result.data.id ? result.data : t))
        : [...prev, result.data],
    );
    setTruckDialog(null);
    toast({ title: editing ? "Truck updated" : "Truck created" });
  }

  async function handleDeleteTruck(truck: Truck) {
    if (!confirm(`Delete truck "${truck.name}"?`)) return;
    const result = await deleteTruck(organizationSlug, truck.id);
    if (!result.ok) {
      fail(result.message);
      return;
    }
    setTrucks((prev) => prev.filter((t) => t.id !== truck.id));
    setTruckZonesList((prev) => prev.filter((tz) => tz.truck_id !== truck.id));
    setSlots((prev) => prev.filter((s) => s.truck_id !== truck.id));
    setBlocks((prev) => prev.filter((b) => b.truck_id !== truck.id));
    toast({ title: "Truck deleted" });
  }

  async function handleToggleTruckZone(truck: Truck, zoneId: string, checked: boolean) {
    const currentZoneIds = truckZones
      .filter((tz) => tz.truck_id === truck.id)
      .map((tz) => tz.zone_id);
    const nextZoneIds = checked
      ? [...currentZoneIds, zoneId]
      : currentZoneIds.filter((id) => id !== zoneId);
    const result = await setTruckZones(organizationSlug, truck.id, nextZoneIds);
    if (!result.ok) {
      fail(result.message);
      return;
    }
    setTruckZonesList((prev) => [
      ...prev.filter((tz) => tz.truck_id !== truck.id),
      ...nextZoneIds.map((id) => ({
        truck_id: truck.id,
        zone_id: id,
        organization_id: truck.organization_id,
      })),
    ]);
  }

  // -- Slots --------------------------------------------------------------

  async function handleSlotSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!slotDialog) return;
    const form = new FormData(e.currentTarget);
    const editing = slotDialog.slot;
    const maxOrdersRaw = String(form.get("maxOrders") ?? "").trim();
    const input = {
      truckId: slotDialog.truckId,
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
      return;
    }
    setSlots((prev) =>
      editing
        ? prev.map((s) => (s.id === result.data.id ? result.data : s))
        : [...prev, result.data],
    );
    setSlotDialog(null);
    toast({ title: editing ? "Slot updated" : "Slot created" });
  }

  async function handleDeleteSlot(slot: DeliverySlot) {
    if (!confirm("Delete this delivery slot?")) return;
    const result = await deleteSlot(organizationSlug, slot.id);
    if (!result.ok) {
      fail(result.message);
      return;
    }
    setSlots((prev) => prev.filter((s) => s.id !== slot.id));
    toast({ title: "Slot deleted" });
  }

  // -- Blocked dates --------------------------------------------------

  async function handleAddBlock(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = {
      blockDate: blockForm.blockDate,
      truckId: blockForm.truckId === "all" ? null : blockForm.truckId,
      reason: blockForm.reason.trim() === "" ? undefined : blockForm.reason.trim(),
    };
    const result = await createBlock(organizationSlug, input);
    if (!result.ok) {
      fail(result.message);
      return;
    }
    setBlocks((prev) => [...prev, result.data]);
    setBlockForm({ blockDate: "", truckId: "all", reason: "" });
    toast({ title: "Blocked date added" });
  }

  async function handleDeleteBlock(block: ScheduleBlock) {
    if (!confirm("Remove this blocked date?")) return;
    const result = await deleteBlock(organizationSlug, block.id);
    if (!result.ok) {
      fail(result.message);
      return;
    }
    setBlocks((prev) => prev.filter((b) => b.id !== block.id));
    toast({ title: "Blocked date removed" });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Delivery Setup</h1>
        <p className="text-muted-foreground">
          Zones, trucks, weekly slots, and blocked dates for the delivery schedule
        </p>
      </div>

      <Tabs defaultValue="zones">
        <TabsList>
          <TabsTrigger value="zones">Zones</TabsTrigger>
          <TabsTrigger value="trucks">Trucks</TabsTrigger>
          <TabsTrigger value="slots">Slots</TabsTrigger>
          <TabsTrigger value="blocks">Blocked dates</TabsTrigger>
        </TabsList>

        <TabsContent value="zones" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setZoneDialog({})}>
              <Plus className="mr-2 h-4 w-4" />
              Add zone
            </Button>
          </div>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {zones.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      No zones yet
                    </TableCell>
                  </TableRow>
                ) : (
                  zones.map((zone) => (
                    <TableRow key={zone.id}>
                      <TableCell className="font-medium">{zone.name}</TableCell>
                      <TableCell>{zone.display_order}</TableCell>
                      <TableCell>{zone.is_active ? "Active" : "Inactive"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setZoneDialog({ zone })}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleDeleteZone(zone)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="trucks" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setTruckDialog({})}>
              <Plus className="mr-2 h-4 w-4" />
              Add truck
            </Button>
          </div>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Zones covered</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trucks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      No trucks yet
                    </TableCell>
                  </TableRow>
                ) : (
                  trucks.map((truck) => {
                    const coveredZoneIds = new Set(
                      truckZones
                        .filter((tz) => tz.truck_id === truck.id)
                        .map((tz) => tz.zone_id),
                    );
                    return (
                      <TableRow key={truck.id}>
                        <TableCell className="font-medium">{truck.name}</TableCell>
                        <TableCell>{truck.code}</TableCell>
                        <TableCell>{truck.is_active ? "Active" : "Inactive"}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-3">
                            {zones.map((zone) => (
                              <label key={zone.id} className="flex items-center gap-1.5 text-sm">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4"
                                  checked={coveredZoneIds.has(zone.id)}
                                  onChange={(e) =>
                                    handleToggleTruckZone(truck, zone.id, e.target.checked)
                                  }
                                />
                                {zone.name}
                              </label>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => setTruckDialog({ truck })}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleDeleteTruck(truck)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="slots" className="space-y-6">
          {trucks.length === 0 ? (
            <p className="text-muted-foreground">Add a truck first to configure its slots.</p>
          ) : (
            trucks.map((truck) => {
              const truckSlots = slots
                .filter((s) => s.truck_id === truck.id)
                .sort(
                  (a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time),
                );
              return (
                <div key={truck.id} className="space-y-2 rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">
                      {truck.name} <span className="text-muted-foreground">({truck.code})</span>
                    </h3>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSlotDialog({ truckId: truck.id })}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add slot
                    </Button>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Weekday</TableHead>
                        <TableHead>Start</TableHead>
                        <TableHead>End</TableHead>
                        <TableHead>Max orders</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-24">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {truckSlots.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={6}
                            className="py-6 text-center text-muted-foreground"
                          >
                            No slots yet
                          </TableCell>
                        </TableRow>
                      ) : (
                        truckSlots.map((slot) => (
                          <TableRow key={slot.id}>
                            <TableCell>{WEEKDAY_LABELS[slot.weekday]}</TableCell>
                            <TableCell>{slot.start_time}</TableCell>
                            <TableCell>{slot.end_time}</TableCell>
                            <TableCell>{slot.max_orders ?? "Unlimited"}</TableCell>
                            <TableCell>{slot.is_active ? "Active" : "Inactive"}</TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => setSlotDialog({ truckId: truck.id, slot })}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => handleDeleteSlot(slot)}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="blocks" className="space-y-4">
          <form
            onSubmit={handleAddBlock}
            className="flex flex-wrap items-end gap-3 rounded-lg border p-4"
          >
            <div className="space-y-2">
              <Label htmlFor="block-date">Date</Label>
              <Input
                id="block-date"
                type="date"
                value={blockForm.blockDate}
                onChange={(e) =>
                  setBlockForm((prev) => ({ ...prev, blockDate: e.target.value }))
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Truck</Label>
              <Select
                value={blockForm.truckId}
                onValueChange={(value) => setBlockForm((prev) => ({ ...prev, truckId: value }))}
              >
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All trucks</SelectItem>
                  {trucks.map((truck) => (
                    <SelectItem key={truck.id} value={truck.id}>
                      {truck.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="block-reason">Reason</Label>
              <Input
                id="block-reason"
                value={blockForm.reason}
                onChange={(e) => setBlockForm((prev) => ({ ...prev, reason: e.target.value }))}
                placeholder="e.g. Public holiday"
              />
            </div>
            <Button type="submit">
              <Plus className="mr-2 h-4 w-4" />
              Add blocked date
            </Button>
          </form>

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Truck</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="w-16">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {blocks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      No blocked dates
                    </TableCell>
                  </TableRow>
                ) : (
                  blocks.map((block) => (
                    <TableRow key={block.id}>
                      <TableCell>{block.block_date}</TableCell>
                      <TableCell>
                        {block.truck_id
                          ? (trucks.find((t) => t.id === block.truck_id)?.name ??
                            "Unknown truck")
                          : "All trucks"}
                      </TableCell>
                      <TableCell>{block.reason ?? "-"}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleDeleteBlock(block)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog
        open={zoneDialog !== null}
        onOpenChange={(open) => {
          if (!open) setZoneDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{zoneDialog?.zone ? "Edit zone" : "Add zone"}</DialogTitle>
          </DialogHeader>
          <ZoneForm
            key={zoneDialog?.zone?.id ?? "new-zone"}
            zone={zoneDialog?.zone}
            onSubmit={handleZoneSubmit}
            onCancel={() => setZoneDialog(null)}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={truckDialog !== null}
        onOpenChange={(open) => {
          if (!open) setTruckDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{truckDialog?.truck ? "Edit truck" : "Add truck"}</DialogTitle>
          </DialogHeader>
          <TruckForm
            key={truckDialog?.truck?.id ?? "new-truck"}
            truck={truckDialog?.truck}
            onSubmit={handleTruckSubmit}
            onCancel={() => setTruckDialog(null)}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={slotDialog !== null}
        onOpenChange={(open) => {
          if (!open) setSlotDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{slotDialog?.slot ? "Edit slot" : "Add slot"}</DialogTitle>
          </DialogHeader>
          {slotDialog ? (
            <SlotForm
              key={slotDialog.slot?.id ?? `new-slot-${slotDialog.truckId}`}
              slot={slotDialog.slot}
              onSubmit={handleSlotSubmit}
              onCancel={() => setSlotDialog(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ZoneForm({
  zone,
  onSubmit,
  onCancel,
}: {
  zone?: DeliveryZone;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const [isActive, setIsActive] = useState(zone?.is_active ?? true);

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="zone-name">Name</Label>
        <Input id="zone-name" name="name" defaultValue={zone?.name ?? ""} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="zone-order">Display order</Label>
        <Input
          id="zone-order"
          name="displayOrder"
          type="number"
          defaultValue={zone?.display_order ?? 0}
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          id="zone-active"
          type="checkbox"
          name="isActive"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="h-4 w-4"
        />
        <Label htmlFor="zone-active">Active</Label>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{zone ? "Save changes" : "Create"}</Button>
      </div>
    </form>
  );
}

function TruckForm({
  truck,
  onSubmit,
  onCancel,
}: {
  truck?: Truck;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const [isActive, setIsActive] = useState(truck?.is_active ?? true);

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="truck-name">Name</Label>
        <Input id="truck-name" name="name" defaultValue={truck?.name ?? ""} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="truck-code">Code</Label>
        <Input id="truck-code" name="code" defaultValue={truck?.code ?? ""} required />
      </div>
      <div className="flex items-center gap-2">
        <input
          id="truck-active"
          type="checkbox"
          name="isActive"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="h-4 w-4"
        />
        <Label htmlFor="truck-active">Active</Label>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{truck ? "Save changes" : "Create"}</Button>
      </div>
    </form>
  );
}

function SlotForm({
  slot,
  onSubmit,
  onCancel,
}: {
  slot?: DeliverySlot;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const [weekday, setWeekday] = useState(String(slot?.weekday ?? 1));
  const [isActive, setIsActive] = useState(slot?.is_active ?? true);

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Weekday</Label>
        <Select value={weekday} onValueChange={setWeekday}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WEEKDAY_LABELS.map((label, index) => (
              <SelectItem key={label} value={String(index)}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input type="hidden" name="weekday" value={weekday} readOnly />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="slot-start">Start time</Label>
          <Input
            id="slot-start"
            name="startTime"
            type="time"
            defaultValue={slot?.start_time?.slice(0, 5) ?? "09:00"}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="slot-end">End time</Label>
          <Input
            id="slot-end"
            name="endTime"
            type="time"
            defaultValue={slot?.end_time?.slice(0, 5) ?? "12:00"}
            required
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="slot-max">Max orders (blank = unlimited)</Label>
        <Input
          id="slot-max"
          name="maxOrders"
          type="number"
          min="1"
          defaultValue={slot?.max_orders ?? ""}
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          id="slot-active"
          type="checkbox"
          name="isActive"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="h-4 w-4"
        />
        <Label htmlFor="slot-active">Active</Label>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{slot ? "Save changes" : "Create"}</Button>
      </div>
    </form>
  );
}
