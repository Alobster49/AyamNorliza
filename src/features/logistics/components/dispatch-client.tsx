"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import type { DispatchBoardData } from "../types";
import { getDispatchBoard } from "../server/dispatch-actions";
import { DispatchBoard } from "./dispatch-board";
import { PlanDeck } from "./plan-deck";
import { DayTimeline } from "./timeline-view";
import { useToast } from "@/hooks/use-toast";

type DispatchView = "plan" | "timeline" | "board";

const VIEWS: { id: DispatchView; label: string }[] = [
  { id: "plan", label: "Plan" },
  { id: "timeline", label: "Timeline" },
  { id: "board", label: "Board" },
];

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

  const refetch = useCallback(() => {
    const forDate = dateRef.current;
    startTransition(async () => {
      const result = await getDispatchBoard(organizationSlug, forDate);
      // The user may have switched dates while this request was in flight.
      if (forDate !== dateRef.current) return;
      if (result.ok) setData(result.data);
      else toast({ title: "Error", description: result.message, variant: "destructive" });
    });
  }, [organizationSlug, toast]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Dispatch</h1>
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
        <div className="ml-auto flex rounded-lg border bg-muted p-0.5" role="tablist" aria-label="Dispatch view">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              className={`min-h-9 rounded-md px-3 text-sm transition-colors motion-reduce:transition-none ${
                view === v.id ? "bg-background font-medium shadow-sm" : "text-muted-foreground"
              }`}
              onClick={() => setView(v.id)}
            >
              {v.label}
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
