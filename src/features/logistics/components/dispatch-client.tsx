"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { DispatchBoardData } from "../types";
import { getDispatchBoard } from "../server/dispatch-actions";
import { DispatchBoard } from "./dispatch-board";
import { PlanDeck } from "./plan-deck";
import { DayTimeline } from "./timeline-view";
import { useToast } from "@/hooks/use-toast";

type DispatchView = "plan" | "timeline" | "board";

const VIEWS: DispatchView[] = ["plan", "timeline", "board"];

export function DispatchClient({
  organizationSlug,
  initialDate,
  initialData,
}: {
  organizationSlug: string;
  initialDate: string;
  initialData: DispatchBoardData;
}) {
  const [date, setDate] = useState(initialDate);
  const dateRef = useRef(date);
  const [data, setData] = useState(initialData);
  const [view, setView] = useState<DispatchView>("plan");
  const { toast } = useToast();
  const [, startTransition] = useTransition();
  const t = useTranslations("logistics.dispatch");
  const tLogistics = useTranslations("logistics");

  const refetch = useCallback(() => {
    const forDate = dateRef.current;
    startTransition(async () => {
      const result = await getDispatchBoard(organizationSlug, forDate);
      // The user may have switched dates while this request was in flight.
      if (forDate !== dateRef.current) return;
      if (result.ok) setData(result.data);
      else toast({ title: tLogistics("error"), description: result.message, variant: "destructive" });
    });
  }, [organizationSlug, toast, tLogistics]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <input
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            dateRef.current = e.target.value;
            refetch();
          }}
          className="rounded border px-2 py-1 text-sm"
        />
        {data.facility ? (
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {data.facility.name} — {data.facility.address_line}, {data.facility.postcode}
          </span>
        ) : null}
        <div
          className="ml-auto flex rounded-lg border bg-muted p-0.5"
          role="tablist"
          aria-label={t("views.ariaLabel")}
        >
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              // bg-background would make the selected chip *darker* than the
              // muted track in dark mode, which reads as a hole rather than a
              // selection. A foreground-alpha fill lifts it above the track in
              // dark and drops it below in light — active either way.
              className={`min-h-9 rounded-md px-3 text-sm transition-colors motion-reduce:transition-none ${
                view === v
                  ? "bg-foreground/10 font-medium text-foreground"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              }`}
              onClick={() => setView(v)}
            >
              {t(`views.${v}`)}
            </button>
          ))}
        </div>
      </div>

      {view === "plan" ? (
        <PlanDeck organizationSlug={organizationSlug} date={date} data={data} refetch={refetch} />
      ) : view === "timeline" ? (
        <DayTimeline date={date} data={data} />
      ) : (
        <DispatchBoard organizationSlug={organizationSlug} date={date} data={data} refetch={refetch} />
      )}
    </div>
  );
}
