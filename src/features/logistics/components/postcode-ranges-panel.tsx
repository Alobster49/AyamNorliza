"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { DeliveryZone } from "@/features/orders/types";
import type { ZonePostcodeRange } from "../types";
import { addPostcodeRange, deletePostcodeRange } from "../server/facility-actions";

/** Cross-zone overlaps: pairs of ranges in different zones sharing postcodes. */
function findOverlaps(ranges: ZonePostcodeRange[]): Array<[ZonePostcodeRange, ZonePostcodeRange]> {
  const overlaps: Array<[ZonePostcodeRange, ZonePostcodeRange]> = [];
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      const a = ranges[i]!;
      const b = ranges[j]!;
      if (a.zone_id !== b.zone_id && a.postcode_start <= b.postcode_end && b.postcode_start <= a.postcode_end) {
        overlaps.push([a, b]);
      }
    }
  }
  return overlaps;
}

export function PostcodeRangesPanel({
  organizationSlug,
  zones,
  ranges,
  onRangeAdded,
  onRangeDeleted,
}: {
  organizationSlug: string;
  zones: DeliveryZone[];
  ranges: ZonePostcodeRange[];
  onRangeAdded: (range: ZonePostcodeRange) => void;
  onRangeDeleted: (rangeId: string) => void;
}) {
  const [form, setForm] = useState({ zoneId: zones[0]?.id ?? "", postcodeStart: "", postcodeEnd: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const t = useTranslations("logistics.postcodes");
  const tLogistics = useTranslations("logistics");

  const zoneName = (id: string) => zones.find((z) => z.id === id)?.name ?? "?";
  const overlaps = useMemo(() => findOverlaps(ranges), [ranges]);

  return (
    <div className="flex flex-col gap-4">
      {overlaps.length > 0 ? (
        <div className="rounded border border-yellow-400 bg-yellow-50 p-2 text-xs text-yellow-900">
          {t("overlapWarning", {
            list: overlaps
              .map(
                ([a, b]) =>
                  `${zoneName(a.zone_id)} & ${zoneName(b.zone_id)} (${a.postcode_start}-${a.postcode_end} / ${b.postcode_start}-${b.postcode_end})`,
              )
              .join("; "),
          })}
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("zoneLabel")}</span>
          <select
            value={form.zoneId}
            onChange={(e) => setForm((f) => ({ ...f, zoneId: e.target.value }))}
            className="rounded border px-2 py-1"
          >
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("from")}</span>
          <input
            value={form.postcodeStart}
            onChange={(e) => setForm((f) => ({ ...f, postcodeStart: e.target.value }))}
            className="w-24 rounded border px-2 py-1"
            placeholder="82000"
            maxLength={5}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("to")}</span>
          <input
            value={form.postcodeEnd}
            onChange={(e) => setForm((f) => ({ ...f, postcodeEnd: e.target.value }))}
            className="w-24 rounded border px-2 py-1"
            placeholder="82300"
            maxLength={5}
          />
        </label>
        <button
          type="button"
          disabled={pending || form.zoneId === ""}
          onClick={() => {
            startTransition(async () => {
              const result = await addPostcodeRange(organizationSlug, form);
              setMessage(result.ok ? null : (result.message ?? tLogistics("actionFailed")));
              if (result.ok) {
                onRangeAdded(result.data);
              }
            });
          }}
          className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
        >
          {t("add")}
        </button>
      </div>

      <ul aria-label={t("listAriaLabel")} className="flex flex-col gap-2">
        {ranges.map((r) => (
          <li key={r.id} className="flex items-center justify-between rounded border p-2 text-sm">
            <span>
              <span className="font-medium">{zoneName(r.zone_id)}</span>{" "}
              {r.postcode_start} – {r.postcode_end}
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                const rangeId = r.id;
                startTransition(async () => {
                  const result = await deletePostcodeRange(organizationSlug, rangeId);
                  setMessage(result.ok ? null : (result.message ?? tLogistics("actionFailed")));
                  if (result.ok) {
                    onRangeDeleted(rangeId);
                  }
                });
              }}
              className="text-xs text-destructive"
            >
              {tLogistics("delete")}
            </button>
          </li>
        ))}
        {ranges.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : null}
      </ul>
      {message ? <p className="text-sm text-destructive">{message}</p> : null}
    </div>
  );
}
