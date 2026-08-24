"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  DeliverySlot,
  DeliveryZone,
  Truck,
} from "@/features/orders/types";
import type { Bay } from "../../types";

/** Keys into `logistics.setup.weekday`, indexed 0 (Sun) through 6 (Sat). */
export const WEEKDAY_KEYS = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
] as const;

const selectClass =
  "flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm lg:min-h-10";

/** Comfortable on a warehouse tablet; back to the app default on desktop. */
const inputClass = "min-h-11 lg:min-h-10";

function ActiveToggle({ defaultChecked }: { defaultChecked: boolean }) {
  const t = useTranslations("logistics.setup.fields");
  return (
    <label className="flex min-h-11 items-center gap-2 text-sm">
      <input
        type="checkbox"
        name="isActive"
        defaultChecked={defaultChecked}
        className="h-4 w-4"
      />
      {t("active")}
    </label>
  );
}

export function ZoneFields({ zone }: { zone?: DeliveryZone }) {
  const t = useTranslations("logistics.setup.fields");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="zone-name">{t("name")}</Label>
        <Input
          id="zone-name"
          name="name"
          defaultValue={zone?.name ?? ""}
          required
          className={inputClass}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="zone-order">{t("displayOrder")}</Label>
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
  const t = useTranslations("logistics.setup.fields");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="truck-name">{t("name")}</Label>
        <Input
          id="truck-name"
          name="name"
          defaultValue={truck?.name ?? ""}
          required
          className={inputClass}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="truck-code">{t("code")}</Label>
        <Input
          id="truck-code"
          name="code"
          defaultValue={truck?.code ?? ""}
          required
          className={inputClass}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="truck-capacity">{t("capacityKg")}</Label>
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
        <Label htmlFor="truck-bay">{t("bay")}</Label>
        <select
          id="truck-bay"
          name="bayId"
          defaultValue={truck?.bay_id ?? ""}
          className={selectClass}
        >
          <option value="">{t("unassigned")}</option>
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
  const t = useTranslations("logistics.setup.fields");
  const tWeekday = useTranslations("logistics.setup.weekday");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="slot-truck">{t("truck")}</Label>
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
        <Label htmlFor="slot-weekday">{t("weekday")}</Label>
        <select
          id="slot-weekday"
          name="weekday"
          defaultValue={String(slot?.weekday ?? 1)}
          className={selectClass}
        >
          {WEEKDAY_KEYS.map((key, index) => (
            <option key={key} value={index}>
              {tWeekday(key)}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="slot-start">{t("startTime")}</Label>
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
        <Label htmlFor="slot-end">{t("endTime")}</Label>
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
        <Label htmlFor="slot-max">{t("maxOrders")}</Label>
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
  const t = useTranslations("logistics.setup.fields");
  const tSetup = useTranslations("logistics.setup");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="block-date">{t("date")}</Label>
        <Input
          id="block-date"
          name="blockDate"
          type="date"
          required
          className={inputClass}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="block-truck">{t("truck")}</Label>
        <select
          id="block-truck"
          name="truckId"
          defaultValue="all"
          className={selectClass}
        >
          <option value="all">{tSetup("allTrucks")}</option>
          {trucks.map((truck) => (
            <option key={truck.id} value={truck.id}>
              {truck.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="block-reason">{t("reason")}</Label>
        <Input
          id="block-reason"
          name="reason"
          placeholder={t("reasonPlaceholder")}
          className={inputClass}
        />
      </div>
    </div>
  );
}
