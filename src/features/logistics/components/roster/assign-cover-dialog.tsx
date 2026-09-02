"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { rankCoverCandidates, type RosterView } from "../../lib/roster-model";
import { assignCover, clearCover } from "../../server/roster-actions";

export function AssignCoverDialog({
  open, onOpenChange, organizationSlug, view, truckId, date, preselectDriverId = null, locale, onDone, asSheet = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationSlug: string;
  view: RosterView;
  truckId: string | null;
  date: string | null;
  preselectDriverId?: string | null;
  locale: string;
  onDone: () => void;
  asSheet?: boolean;
}) {
  const t = useTranslations("roster.assign");
  const tErr = useTranslations();
  const { toast } = useToast();
  const [picked, setPicked] = useState<string | null>(preselectDriverId);
  const [busy, startTransition] = useTransition();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs the picked candidate to the dialog's target, matches edit-member-dialog.tsx idiom
    setPicked(preselectDriverId);
  }, [preselectDriverId, truckId, date]);

  const truckRow = view.truckRows.find((r) => r.truck.id === truckId) ?? null;
  const cell = truckRow?.cells.find((c) => c.date === date) ?? null;
  const candidates = useMemo(() => (truckId && date ? rankCoverCandidates(view, truckId, date) : []), [view, truckId, date]);
  const gap = view.gaps.find((g) => g.truckId === truckId && g.date === date) ?? view.risks.find((g) => g.truckId === truckId && g.date === date) ?? null;
  const dayLabel = date ? new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "";
  const truckCode = truckRow?.truck.code ?? "";
  const pickedName = candidates.find((c) => c.driver.userId === picked)?.driver.name ?? "";

  const context = gap?.reason.kind === "leave"
    ? t("contextLeave", { name: gap.reason.driverName, type: gap.reason.leaveType, truck: truckCode })
    : t("contextNoRegular", { truck: truckCode });

  function submit() {
    if (!truckId || !date || !picked) return;
    startTransition(async () => {
      const result = await assignCover(organizationSlug, truckId, date, picked);
      if (!result.ok) {
        toast({ title: tErr("roster.toasts.couldNotSave"), description: result.messageKey ? tErr(result.messageKey as never) : result.message, variant: "destructive" });
        return;
      }
      toast({ title: t("assigned", { name: pickedName, truck: truckCode, date: dayLabel }) });
      onOpenChange(false);
      onDone();
    });
  }

  function clear() {
    if (!truckId || !date) return;
    startTransition(async () => {
      const result = await clearCover(organizationSlug, truckId, date);
      if (!result.ok) {
        toast({ title: tErr("roster.toasts.couldNotSave"), description: result.messageKey ? tErr(result.messageKey as never) : result.message, variant: "destructive" });
        return;
      }
      toast({ title: t("cleared", { truck: truckCode, date: dayLabel }) });
      onOpenChange(false);
      onDone();
    });
  }

  const tierLine = (c: (typeof candidates)[number]) => {
    const own = view.truckRows.find((r) => r.truck.id === c.driver.regularTruckId)?.truck.code ?? "";
    if (c.tier === "free") return c.driver.regularTruckId ? t("tierFreeRegular", { truck: own }) : t("tierFree");
    if (c.tier === "truckOff") return t("tierTruckOff", { truck: own });
    return t("tierBusy", { truck: c.busyTruckCode ?? "" });
  };

  const body = (
    <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto" role="radiogroup" aria-label={t("title")}>
      {candidates.length === 0 ? <p className="text-sm text-muted-foreground">{t("noCandidates")}</p> : null}
      {candidates.map((c) => {
        const on = picked === c.driver.userId;
        return (
          <button
            key={c.driver.userId}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => setPicked(c.driver.userId)}
            className={cn("flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2 text-left", on ? "border-primary bg-muted" : "border-border")}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{c.driver.name.slice(0, 2).toUpperCase()}</span>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <b className="truncate text-sm">{c.driver.name}</b>
              <span className={cn("text-xs", c.tier === "busy" ? "text-destructive" : "text-muted-foreground")}>{tierLine(c)}</span>
            </span>
            <span className={cn("flex size-5 items-center justify-center rounded-full border-2", on ? "border-primary" : "border-border")}>{on ? <span className="size-2.5 rounded-full bg-primary" /> : null}</span>
          </button>
        );
      })}
    </div>
  );

  const footer = (
    <>
      {cell?.state === "cover" ? <Button variant="outline" disabled={busy} onClick={clear}>{t("clear")}</Button> : null}
      <Button disabled={!picked || busy} onClick={submit} className={asSheet ? "h-11 w-full" : ""}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : null}
        {picked ? t("confirm", { name: pickedName, truck: truckCode }) : t("title")}
      </Button>
    </>
  );

  if (asSheet) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader className="text-left">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("title")}</span>
            <SheetTitle>{t("subtitle", { truck: truckCode, date: dayLabel })}</SheetTitle>
            <SheetDescription>{context}</SheetDescription>
          </SheetHeader>
          <div className="py-3">{body}</div>
          <SheetFooter className="flex-col gap-2">{footer}</SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("title")}</span>
          <DialogTitle>{t("subtitle", { truck: truckCode, date: dayLabel })}</DialogTitle>
          <DialogDescription>{context}</DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
