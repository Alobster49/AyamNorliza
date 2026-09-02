"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import type { RosterView } from "../../lib/roster-model";
import { setRegularDriver } from "../../server/roster-actions";

export function RegularDriversDialog({ open, onOpenChange, organizationSlug, view, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; organizationSlug: string; view: RosterView; onDone: () => void }) {
  const t = useTranslations("roster.regular");
  const tErr = useTranslations();
  const { toast } = useToast();
  const [busy, startTransition] = useTransition();
  const initial = Object.fromEntries(view.truckRows.map((r) => [r.truck.id, r.truck.regularDriverId ?? ""]));
  const [draft, setDraft] = useState<Record<string, string>>(initial);
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the draft on open; a lazy initializer can't see the `open` transition, matches apply-leave-dialog.tsx idiom
      setDraft(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `initial` is recomputed every render from `view`; re-seed on open and whenever a refetch hands us different trucks, never on an unrelated render
  }, [open, view]);

  function save() {
    startTransition(async () => {
      for (const row of view.truckRows) {
        const next = draft[row.truck.id] || null;
        if (next === (row.truck.regularDriverId ?? null)) continue;
        const result = await setRegularDriver(organizationSlug, row.truck.id, next);
        if (!result.ok) {
          toast({ title: tErr("roster.toasts.couldNotSave"), description: result.messageKey ? tErr(result.messageKey as never) : result.message, variant: "destructive" });
          // Earlier trucks in the loop may already have saved. Refresh so the
          // grid (and this dialog's draft) shows what actually landed, and
          // leave the dialog open so the planner can retry the one that failed.
          onDone();
          return;
        }
      }
      toast({ title: t("saved") });
      onOpenChange(false);
      onDone();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60vh] gap-3 overflow-y-auto">
          {view.truckRows.map((row) => (
            <div key={row.truck.id} className="grid grid-cols-[1fr_auto] items-center gap-3">
              <Label htmlFor={`regular-${row.truck.id}`} className="leading-tight">
                <span className="block text-sm font-semibold">{row.truck.code}</span>
                <span className="block text-xs text-muted-foreground">{row.truck.name}</span>
              </Label>
              <select
                id={`regular-${row.truck.id}`}
                value={draft[row.truck.id] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [row.truck.id]: e.target.value }))}
                className="h-9 min-w-44 rounded-2xl border bg-background px-3 text-sm"
              >
                <option value="">{t("none")}</option>
                {view.driverRows.map((d) => (
                  <option key={d.driver.userId} value={d.driver.userId}>{d.driver.name}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}{t("save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
