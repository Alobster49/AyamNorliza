"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  arriveStop,
  deliverStop,
  failStop,
  getDriverRun,
} from "@/features/orders/server/driver-actions";
import {
  DELIVERY_FAILURE_LABELS,
  DELIVERY_FAILURE_REASONS,
  DELIVERY_NEXT_ACTIONS,
  DELIVERY_NEXT_ACTION_LABELS,
  type DeliveryFailureReason,
  type DeliveryNextAction,
  type RunWithOrders,
} from "@/features/orders/types";
import { buildDriverDeck, type DriverStop } from "@/features/orders/lib/driver-run-model";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

type Sheet = "none" | "deliver" | "fail";

function money(amount: number): string {
  return `RM ${amount.toFixed(2)}`;
}

function mapsHref(stop: DriverStop): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stop.address)}`;
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-emerald-500 transition-[width] duration-300 ease-out motion-reduce:transition-none"
        style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
      />
    </div>
  );
}

export function DriverDeck({
  organizationSlug,
  organizationId,
  initialRun,
}: {
  organizationSlug: string;
  organizationId: string;
  initialRun: RunWithOrders;
}) {
  const { toast } = useToast();
  const [run, setRun] = useState(initialRun);
  const [sheet, setSheet] = useState<Sheet>("none");
  const [busy, startTransition] = useTransition();
  const [receivedBy, setReceivedBy] = useState("");
  const [cash, setCash] = useState("");
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [reason, setReason] = useState<DeliveryFailureReason | null>(null);
  const [nextAction, setNextAction] = useState<DeliveryNextAction>("retry_today");
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const deck = useMemo(() => buildDriverDeck(run), [run]);
  const stop = deck.current;

  async function refresh() {
    // Always by id: the office opens a driver's deck with ?run=, and a lookup
    // by "the run I am driving" would find nothing for them and silently
    // leave the screen stale after every action.
    const result = await getDriverRun(organizationSlug, run.id);
    if (result.ok && result.data.run) {
      setRun(result.data.run);
      return;
    }
    if (!result.ok) {
      toast({ title: "Could not refresh the run", description: result.message, variant: "destructive" });
    }
  }

  function resetSheet() {
    setSheet("none");
    setReceivedBy("");
    setCash("");
    setPhotoPath(null);
    setReason(null);
    setNote("");
    setNextAction("retry_today");
  }

  function handleArrive() {
    if (!stop) return;
    startTransition(async () => {
      const result = await arriveStop(organizationSlug, stop.orderId);
      if (!result.ok) {
        toast({ title: "Could not record arrival", description: result.message, variant: "destructive" });
        return;
      }
      await refresh();
    });
  }

  async function handlePhoto(file: File) {
    setPhotoBusy(true);
    const supabase = createSupabaseBrowserClient();
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const path = `${organizationId}/${run.id}/${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from("delivery-pod").upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    setPhotoBusy(false);
    if (error) {
      toast({ title: "Photo did not upload", description: error.message, variant: "destructive" });
      return;
    }
    setPhotoPath(path);
  }

  function handleDeliver() {
    if (!stop) return;
    const trimmedCash = cash.trim();
    const cashCollected = trimmedCash === "" ? null : Number(trimmedCash);
    if (cashCollected !== null && (Number.isNaN(cashCollected) || cashCollected < 0)) {
      toast({ title: "Check the cash amount", description: "Enter a number, or leave it blank.", variant: "destructive" });
      return;
    }

    startTransition(async () => {
      const result = await deliverStop(organizationSlug, stop.orderId, {
        receivedBy: receivedBy.trim() || null,
        photoPath,
        cashCollected,
      });
      if (!result.ok) {
        toast({ title: "Could not record the delivery", description: result.message, variant: "destructive" });
        return;
      }
      toast({ title: `Delivered to ${stop.customerName}` });
      resetSheet();
      await refresh();
    });
  }

  function handleFail() {
    if (!stop || !reason) return;
    startTransition(async () => {
      const result = await failStop(organizationSlug, stop.orderId, reason, nextAction, note.trim() || null);
      if (!result.ok) {
        toast({ title: "Could not report the stop", description: result.message, variant: "destructive" });
        return;
      }
      toast({ title: "Reported to the office" });
      resetSheet();
      await refresh();
    });
  }

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Run header */}
      <header className="sticky top-0 z-10 border-b bg-background/85 px-4 py-3 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold">
              {stop ? `Stop ${stop.sequence} of ${deck.total}` : "Run finished"}
            </h1>
            <p className="text-xs text-muted-foreground">
              {deck.truckLabel} · {deck.remaining} left
              {deck.failed > 0 ? ` · ${deck.failed} to sort out` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Cash</p>
            <p className="text-sm font-semibold tabular-nums">{money(deck.cashCollected)}</p>
          </div>
        </div>
        <div className="mt-2">
          <Bar pct={deck.progressPct} />
        </div>
      </header>

      {!stop ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-lg font-semibold">Every stop is done.</p>
          <p className="text-sm text-muted-foreground">
            {deck.delivered} delivered{deck.failed > 0 ? `, ${deck.failed} could not be delivered` : ""}. Head
            back to the yard and hand in {money(deck.cashCollected)}.
          </p>
        </div>
      ) : (
        <main className="flex flex-1 flex-col gap-3 p-3">
          {/* The stop */}
          <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="flex flex-col gap-3 border-b bg-accent/30 p-4">
              <div className="flex flex-wrap items-center gap-2">
                {stop.window && (
                  <span className="rounded-md bg-background px-2 py-0.5 text-[11px] font-medium">
                    {stop.window.start}–{stop.window.end}
                  </span>
                )}
                <span className="rounded-md bg-background px-2 py-0.5 text-[11px] font-medium tabular-nums">
                  {money(stop.amount)}
                </span>
                {stop.outcome === "failed" && stop.lastFailureReason && (
                  <span className="rounded-md bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800 dark:bg-red-950 dark:text-red-300">
                    Retry · {DELIVERY_FAILURE_LABELS[stop.lastFailureReason]}
                  </span>
                )}
                {stop.atStop && (
                  <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    At the door{stop.dwellMinutes !== null ? ` · ${stop.dwellMinutes} min` : ""}
                  </span>
                )}
              </div>

              <div>
                <h2 className="text-lg font-semibold leading-tight">{stop.customerName}</h2>
                <p className="text-sm text-muted-foreground">{stop.address}</p>
                <p className="text-xs text-muted-foreground">
                  {stop.zoneName} · {stop.itemCount} item{stop.itemCount === 1 ? "" : "s"}
                  {stop.weightKg > 0 ? ` · ${stop.weightKg} kg` : ""}
                </p>
                {stop.notes && <p className="mt-1 text-xs italic text-muted-foreground">“{stop.notes}”</p>}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <a
                  href={stop.phone ? `tel:${stop.phone}` : undefined}
                  aria-disabled={!stop.phone}
                  className={`flex min-h-11 flex-col items-center justify-center rounded-xl border bg-background text-xs font-medium ${
                    stop.phone ? "" : "pointer-events-none opacity-40"
                  }`}
                >
                  Call
                </a>
                <a
                  href={mapsHref(stop)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-11 flex-col items-center justify-center rounded-xl border bg-background text-xs font-medium"
                >
                  Navigate
                </a>
                <a
                  href={stop.phone ? `https://wa.me/${stop.phone.replace(/[^0-9]/g, "")}` : undefined}
                  aria-disabled={!stop.phone}
                  target="_blank"
                  rel="noreferrer"
                  className={`flex min-h-11 flex-col items-center justify-center rounded-xl border bg-background text-xs font-medium ${
                    stop.phone ? "" : "pointer-events-none opacity-40"
                  }`}
                >
                  WhatsApp
                </a>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 p-4">
              {!stop.atStop ? (
                <Button size="lg" className="h-12 w-full text-base" disabled={busy} onClick={handleArrive}>
                  I&apos;m at the door
                </Button>
              ) : (
                <Button
                  size="lg"
                  className="h-12 w-full bg-emerald-600 text-base hover:bg-emerald-700"
                  disabled={busy}
                  onClick={() => setSheet("deliver")}
                >
                  Delivered
                </Button>
              )}
              <Button
                variant="outline"
                className="h-11 w-full"
                disabled={busy}
                onClick={() => setSheet("fail")}
              >
                Can&apos;t deliver
              </Button>
            </div>
          </section>

          {/* Next stop peek */}
          {deck.next && (
            <section className="rounded-xl border bg-muted/40 px-4 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Next</p>
              <p className="text-sm font-medium">
                {deck.next.sequence} · {deck.next.customerName}
              </p>
              <p className="text-xs text-muted-foreground">
                {deck.next.zoneName}
                {deck.next.weightKg > 0 ? ` · ${deck.next.weightKg} kg` : ""}
                {deck.next.window ? ` · ${deck.next.window.start}–${deck.next.window.end}` : ""}
              </p>
            </section>
          )}

          {/* Whole route, for orientation */}
          <details className="rounded-xl border bg-card">
            <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">
              Whole run · {deck.delivered}/{deck.total} done
            </summary>
            <ul className="divide-y border-t">
              {deck.stops.map((item) => (
                <li key={item.orderId} className="flex items-center justify-between gap-3 px-4 py-2">
                  <span className="min-w-0 text-sm">
                    <span className="mr-1.5 text-xs tabular-nums text-muted-foreground">{item.sequence}</span>
                    {item.customerName}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {item.outcome === "delivered"
                      ? "Dropped"
                      : item.outcome === "failed"
                        ? "Failed"
                        : item.outcome === "cancelled"
                          ? "Cancelled"
                          : item.atStop
                            ? "Here now"
                            : "To do"}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </main>
      )}

      {/* Proof of delivery */}
      {sheet === "deliver" && stop && (
        <div className="fixed inset-0 z-20 flex items-end bg-black/40" role="dialog" aria-modal="true">
          <div className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl border-t bg-background p-4">
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-muted" />
            <h2 className="text-base font-semibold">Proof of delivery</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              {stop.customerName} · all of this is optional
            </p>

            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium">
                Received by
                <Input
                  value={receivedBy}
                  onChange={(event) => setReceivedBy(event.target.value)}
                  placeholder="Name of whoever took it"
                  className="h-11"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs font-medium">
                Cash collected
                <Input
                  value={cash}
                  onChange={(event) => setCash(event.target.value)}
                  inputMode="decimal"
                  placeholder={money(stop.amount)}
                  className="h-11"
                />
              </label>

              <div className="flex flex-col gap-1 text-xs font-medium">
                Photo at the door
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handlePhoto(file);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  disabled={photoBusy}
                  onClick={() => fileRef.current?.click()}
                >
                  {photoBusy ? "Uploading…" : photoPath ? "Photo attached · replace" : "Take a photo"}
                </Button>
              </div>

              <div className="mt-1 flex gap-2">
                <Button variant="outline" className="h-11 flex-1" onClick={resetSheet} disabled={busy}>
                  Back
                </Button>
                <Button
                  className="h-11 flex-[2] bg-emerald-600 hover:bg-emerald-700"
                  onClick={handleDeliver}
                  disabled={busy || photoBusy}
                >
                  Confirm delivery
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Failure report */}
      {sheet === "fail" && stop && (
        <div className="fixed inset-0 z-20 flex items-end bg-black/40" role="dialog" aria-modal="true">
          <div className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl border-t bg-background p-4">
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-muted" />
            <h2 className="text-base font-semibold">Can&apos;t deliver</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              {stop.customerName} · the order stays open, the office is told now
            </p>

            <div className="flex flex-col gap-2">
              {DELIVERY_FAILURE_REASONS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setReason(value)}
                  className={`min-h-11 rounded-xl border px-3 text-left text-sm font-medium ${
                    reason === value ? "border-destructive bg-destructive/10" : "bg-card"
                  }`}
                >
                  {DELIVERY_FAILURE_LABELS[value]}
                </button>
              ))}

              <p className="mt-2 text-[11px] uppercase tracking-wide text-muted-foreground">Then what</p>
              <div className="flex flex-wrap gap-2">
                {DELIVERY_NEXT_ACTIONS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setNextAction(value)}
                    className={`min-h-9 rounded-full border px-3 text-xs font-medium ${
                      nextAction === value ? "border-primary bg-accent" : "bg-card"
                    }`}
                  >
                    {DELIVERY_NEXT_ACTION_LABELS[value]}
                  </button>
                ))}
              </div>

              <label className="mt-1 flex flex-col gap-1 text-xs font-medium">
                Anything the office should know
                <Input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Gate locked, guard said back at 3pm"
                  className="h-11"
                />
              </label>

              <div className="mt-1 flex gap-2">
                <Button variant="outline" className="h-11 flex-1" onClick={resetSheet} disabled={busy}>
                  Back
                </Button>
                <Button
                  className="h-11 flex-[2]"
                  variant="destructive"
                  onClick={handleFail}
                  disabled={busy || reason === null}
                >
                  Report and move on
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
