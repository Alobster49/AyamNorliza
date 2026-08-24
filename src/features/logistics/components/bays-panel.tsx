"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { Truck } from "@/features/orders/types";
import type { Bay } from "../types";
import { createBay, deleteBay, setTruckBay } from "../server/facility-actions";

export function BaysPanel({
  organizationSlug,
  facilityId,
  bays,
  trucks,
  onBayCreated,
  onBayDeleted,
  onTruckBayChanged,
}: {
  organizationSlug: string;
  facilityId: string | null;
  bays: Bay[];
  trucks: Truck[];
  onBayCreated: (bay: Bay) => void;
  onBayDeleted: (bayId: string) => void;
  onTruckBayChanged: (truckId: string, bayId: string | null) => void;
}) {
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const t = useTranslations("logistics.bays");
  const tLogistics = useTranslations("logistics");

  return (
    <div className="flex flex-col gap-4">
      {facilityId ? (
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t("newNameLabel")}</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="rounded border px-2 py-1"
              placeholder={t("newNamePlaceholder")}
            />
          </label>
          <button
            type="button"
            disabled={pending || newName.trim() === ""}
            onClick={() => {
              const name = newName.trim();
              startTransition(async () => {
                const result = await createBay(organizationSlug, {
                  facilityId,
                  name,
                  position: bays.length + 1,
                });
                setMessage(result.ok ? null : (result.message ?? tLogistics("actionFailed")));
                if (result.ok) {
                  onBayCreated(result.data);
                }
              });
              setNewName("");
            }}
            className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
          >
            {t("add")}
          </button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("needFacility")}</p>
      )}

      <ul className="flex flex-col gap-2">
        {bays.map((bay) => (
          <li key={bay.id} className="flex items-center justify-between rounded border p-2 text-sm">
            <span className="font-medium">{bay.name}</span>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                const bayId = bay.id;
                startTransition(async () => {
                  const result = await deleteBay(organizationSlug, bayId);
                  setMessage(result.ok ? null : (result.message ?? tLogistics("actionFailed")));
                  if (result.ok) {
                    onBayDeleted(bayId);
                  }
                });
              }}
              className="text-xs text-destructive"
            >
              {tLogistics("delete")}
            </button>
          </li>
        ))}
      </ul>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{t("truckAssignmentTitle")}</h3>
        <ul className="flex flex-col gap-2">
          {trucks.map((truck) => (
            <li key={truck.id} className="flex items-center justify-between rounded border p-2 text-sm">
              <span>
                {truck.name} <span className="text-xs text-muted-foreground">{truck.code}</span>
              </span>
              <select
                value={truck.bay_id ?? ""}
                disabled={pending}
                onChange={(e) => {
                  const truckId = truck.id;
                  const bayId = e.target.value || null;
                  startTransition(async () => {
                    const result = await setTruckBay(organizationSlug, truckId, bayId);
                    setMessage(result.ok ? null : (result.message ?? tLogistics("actionFailed")));
                    if (result.ok) {
                      onTruckBayChanged(truckId, bayId);
                    }
                  });
                }}
                className="rounded border px-2 py-1 text-sm"
              >
                <option value="">{t("noBay")}</option>
                {bays.map((bay) => (
                  <option key={bay.id} value={bay.id}>
                    {bay.name}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      </div>
      {message ? <p className="text-sm text-destructive">{message}</p> : null}
    </div>
  );
}
