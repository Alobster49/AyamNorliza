"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  DeliverySlot,
  DeliveryZone,
  Truck,
} from "@/features/orders/types";
import type { Bay } from "../../types";

export const WEEKDAY_LABELS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

const selectClass =
  "flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm lg:min-h-10";

/** Comfortable on a warehouse tablet; back to the app default on desktop. */
const inputClass = "min-h-11 lg:min-h-10";

function ActiveToggle({ defaultChecked }: { defaultChecked: boolean }) {
  return (
    <label className="flex min-h-11 items-center gap-2 text-sm">
      <input
        type="checkbox"
        name="isActive"
        defaultChecked={defaultChecked}
        className="h-4 w-4"
      />
      Active
    </label>
  );
}

export function ZoneFields({ zone }: { zone?: DeliveryZone }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="zone-name">Name</Label>
        <Input
          id="zone-name"
          name="name"
          defaultValue={zone?.name ?? ""}
          required
          className={inputClass}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="zone-order">Display order</Label>
        <Input
          id="zone-order"
          name="displayOrder"
          type="number"
          defaultValue={zone?.display_order ?? 0}
          className={inputClass}
        />
      </div>
      <div className="flex items-end">
        <ActiveToggle defaultChecked={zone?.is_active ?? true} />
      </div>
    </div>
  );
}

export function TruckFields({ truck, bays }: { truck?: Truck; bays: Bay[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="truck-name">Name</Label>
        <Input
          id="truck-name"
          name="name"
          defaultValue={truck?.name ?? ""}
          required
          className={inputClass}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="truck-code">Code</Label>
        <Input
          id="truck-code"
          name="code"
          defaultValue={truck?.code ?? ""}
          required
          className={inputClass}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="truck-capacity">
          Capacity kg (blank = not recorded)
        </Label>
        <Input
          id="truck-capacity"
          name="capacityKg"
          type="number"
          min="1"
          defaultValue={truck?.capacity_kg ?? ""}
          className={inputClass}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="truck-bay">Bay</Label>
        <select
          id="truck-bay"
          name="bayId"
          defaultValue={truck?.bay_id ?? ""}
          className={selectClass}
        >
          <option value="">Unassigned</option>
          {bays.map((bay) => (
            <option key={bay.id} value={bay.id}>
              {bay.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end sm:col-span-2">
        <ActiveToggle defaultChecked={truck?.is_active ?? true} />
      </div>
    </div>
  );
}

export function SlotFields({
  slot,
  trucks,
  defaultTruckId,
}: {
  slot?: DeliverySlot;
  trucks: Truck[];
  defaultTruckId: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="slot-truck">Truck</Label>
        <select
          id="slot-truck"
          name="truckId"
          defaultValue={slot?.truck_id ?? defaultTruckId}
          className={selectClass}
        >
          {trucks.map((truck) => (
            <option key={truck.id} value={truck.id}>
              {truck.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="slot-weekday">Weekday</Label>
        <select
          id="slot-weekday"
          name="weekday"
          defaultValue={String(slot?.weekday ?? 1)}
          className={selectClass}
        >
          {WEEKDAY_LABELS.map((label, index) => (
            <option key={label} value={index}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="slot-start">Start time</Label>
        <Input
          id="slot-start"
          name="startTime"
          type="time"
          defaultValue={slot?.start_time?.slice(0, 5) ?? "09:00"}
          required
          className={inputClass}
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
          className={inputClass}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="slot-max">Max orders (blank = unlimited)</Label>
        <Input
          id="slot-max"
          name="maxOrders"
          type="number"
          min="1"
          defaultValue={slot?.max_orders ?? ""}
          className={inputClass}
        />
      </div>
      <div className="flex items-end">
        <ActiveToggle defaultChecked={slot?.is_active ?? true} />
      </div>
    </div>
  );
}

export function BlockFields({ trucks }: { trucks: Truck[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="block-date">Date</Label>
        <Input
          id="block-date"
          name="blockDate"
          type="date"
          required
          className={inputClass}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="block-truck">Truck</Label>
        <select
          id="block-truck"
          name="truckId"
          defaultValue="all"
          className={selectClass}
        >
          <option value="all">All trucks</option>
          {trucks.map((truck) => (
            <option key={truck.id} value={truck.id}>
              {truck.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="block-reason">Reason</Label>
        <Input
          id="block-reason"
          name="reason"
          placeholder="e.g. Hari Raya Haji"
          className={inputClass}
        />
      </div>
    </div>
  );
}
