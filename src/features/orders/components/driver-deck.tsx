"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  arriveStop,
  deliverStop,
  failStop,
  getDriverRun,
} from "@/features/orders/server/driver-actions";
import {
  DELIVERY_FAILURE_REASON_KEY,
  DELIVERY_FAILURE_REASONS,
  DELIVERY_NEXT_ACTIONS,
  type DeliveryFailureReason,
  type DeliveryNextAction,
  type RunWithOrders,
} from "@/features/orders/types";
import { buildDriverDeck, type DriverStop } from "@/features/orders/lib/driver-run-model";
import { formatPrice, formatWeight } from "@/features/orders/lib/order-model";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

type Sheet = "none" | "deliver" | "fail";

/** `status.delivery.nextAction` sub-keys, keyed by the snake_case action values. */
const NEXT_ACTION_KEY: Record<DeliveryNextAction, string> = {
  retry_today: "retryToday",
  move_tomorrow: "moveTomorrow",
  return_to_yard: "returnToYard",
};

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
  const t = useTranslations("orders.driverDeck");
  const tStatus = useTranslations("status.delivery");
  const tRoot = useTranslations();
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
      toast({
        title: t("toast.refreshFailedTitle"),
        // `messageKey` is a dynamic full path (e.g. "errors.drive.run.loadFailed");
        // next-intl's typed `t()` only accepts literal keys, so this is cast at the call site.
        description: result.messageKey ? tRoot(result.messageKey as never) : result.message,
        variant: "destructive",
      });
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
        toast({
          title: t("toast.arriveFailedTitle"),
          description: result.messageKey ? tRoot(result.messageKey as never) : result.message,
          variant: "destructive",
        });
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
      // Raw Supabase Storage error text — not part of our message catalog.
      toast({ title: t("toast.photoFailedTitle"), description: error.message, variant: "destructive" });
      return;
    }
    setPhotoPath(path);
  }

  function handleDeliver() {
    if (!stop) return;
    const trimmedCash = cash.trim();
    const cashCollected = trimmedCash === "" ? null : Number(trimmedCash);
    if (cashCollected !== null && (Number.isNaN(cashCollected) || cashCollected < 0)) {
      toast({
        title: t("toast.cashInvalidTitle"),
        description: t("toast.cashInvalidDescription"),
        variant: "destructive",
      });
      return;
    }

    startTransition(async () => {
      const result = await deliverStop(organizationSlug, stop.orderId, {
        receivedBy: receivedBy.trim() || null,
        photoPath,
        cashCollected,
        lines: [], // Task 4 replaces this
      });
      if (!result.ok) {
        toast({
          title: t("toast.deliverFailedTitle"),
          description: result.messageKey ? tRoot(result.messageKey as never) : result.message,
          variant: "destructive",
        });
        return;
      }
      toast({ title: t("toast.deliveredTitle", { name: stop.customerName }) });
      resetSheet();
      await refresh();
    });
  }

  function handleFail() {
    if (!stop || !reason) return;
    startTransition(async () => {
      const result = await failStop(organizationSlug, stop.orderId, reason, nextAction, note.trim() || null);
      if (!result.ok) {
        toast({
          title: t("toast.failFailedTitle"),
          description: result.messageKey ? tRoot(result.messageKey as never) : result.message,
          variant: "destructive",
        });
        return;
      }
      toast({ title: t("toast.reportedTitle") });
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
              {stop ? t("header.stopOf", { sequence: stop.sequence, total: deck.total }) : t("header.runFinished")}
            </h1>
            <p className="text-xs text-muted-foreground">
              {deck.truckLabel ?? t("truckFallback")} · {t("header.remaining", { count: deck.remaining })}
              {deck.failed > 0 ? ` · ${t("header.toSortOut", { count: deck.failed })}` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("header.cash")}</p>
            <p className="text-sm font-semibold tabular-nums">{formatPrice(deck.cashCollected)}</p>
          </div>
        </div>
        <div className="mt-2">
          <Bar pct={deck.progressPct} />
        </div>
      </header>

      {!stop ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-lg font-semibold">{t("finished.title")}</p>
          <p className="text-sm text-muted-foreground">
            {t("finished.delivered", { count: deck.delivered })}
            {deck.failed > 0 ? `, ${t("finished.couldNotDeliver", { count: deck.failed })}` : ""}.{" "}
            {t("finished.wrapUp", { amount: formatPrice(deck.cashCollected) })}
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
                  {formatPrice(stop.amount)}
                </span>
                {stop.outcome === "failed" && stop.lastFailureReason && (
                  <span className="rounded-md bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800 dark:bg-red-950 dark:text-red-300">
                    {t("retryLabel", {
                      reason: tStatus(`failureReason.${DELIVERY_FAILURE_REASON_KEY[stop.lastFailureReason]}` as never),
                    })}
                  </span>
                )}
                {stop.atStop && (
                  <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    {t("atDoor")}
                    {stop.dwellMinutes !== null ? ` · ${t("dwellMinutes", { count: stop.dwellMinutes })}` : ""}
                  </span>
                )}
              </div>

              <div>
                <h2 className="text-lg font-semibold leading-tight">{stop.customerName}</h2>
                <p className="text-sm text-muted-foreground">{stop.address}</p>
                <p className="text-xs text-muted-foreground">
                  {stop.zoneName} · {t("itemCount", { count: stop.itemCount })}
                  {stop.weightKg > 0 ? ` · ${formatWeight(stop.weightKg)}` : ""}
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
                  {t("actions.call")}
                </a>
                <a
                  href={mapsHref(stop)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-11 flex-col items-center justify-center rounded-xl border bg-background text-xs font-medium"
                >
                  {t("actions.navigate")}
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
                  {t("actions.whatsapp")}
                </a>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 p-4">
              {!stop.atStop ? (
                <Button size="lg" className="h-12 w-full text-base" disabled={busy} onClick={handleArrive}>
                  {t("actions.imAtDoor")}
                </Button>
              ) : (
                <Button
                  size="lg"
                  className="h-12 w-full bg-emerald-600 text-base hover:bg-emerald-700"
                  disabled={busy}
                  onClick={() => setSheet("deliver")}
                >
                  {t("actions.delivered")}
                </Button>
              )}
              <Button
                variant="outline"
                className="h-11 w-full"
                disabled={busy}
                onClick={() => setSheet("fail")}
              >
                {t("actions.cantDeliver")}
              </Button>
            </div>
          </section>

          {/* Next stop peek */}
          {deck.next && (
            <section className="rounded-xl border bg-muted/40 px-4 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("next.label")}</p>
              <p className="text-sm font-medium">
                {deck.next.sequence} · {deck.next.customerName}
              </p>
              <p className="text-xs text-muted-foreground">
                {deck.next.zoneName}
                {deck.next.weightKg > 0 ? ` · ${formatWeight(deck.next.weightKg)}` : ""}
                {deck.next.window ? ` · ${deck.next.window.start}–${deck.next.window.end}` : ""}
              </p>
            </section>
          )}

          {/* Whole route, for orientation */}
          <details className="rounded-xl border bg-card">
            <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">
              {t("wholeRun.summary", { delivered: deck.delivered, total: deck.total })}
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
                      ? t("stopStatus.dropped")
                      : item.outcome === "failed"
                        ? t("stopStatus.failed")
                        : item.outcome === "cancelled"
                          ? t("stopStatus.cancelled")
                          : item.atStop
                            ? t("stopStatus.hereNow")
                            : t("stopStatus.toDo")}
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
            <h2 className="text-base font-semibold">{t("deliverSheet.title")}</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              {t("deliverSheet.subtitle", { name: stop.customerName })}
            </p>

            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium">
                {t("deliverSheet.receivedByLabel")}
                <Input
                  value={receivedBy}
                  onChange={(event) => setReceivedBy(event.target.value)}
                  placeholder={t("deliverSheet.receivedByPlaceholder")}
                  className="h-11"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs font-medium">
                {t("deliverSheet.cashLabel")}
                <Input
                  value={cash}
                  onChange={(event) => setCash(event.target.value)}
                  inputMode="decimal"
                  placeholder={formatPrice(stop.amount)}
                  className="h-11"
                />
              </label>

              <div className="flex flex-col gap-1 text-xs font-medium">
                {t("deliverSheet.photoLabel")}
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
                  {photoBusy
                    ? t("deliverSheet.photoUploading")
                    : photoPath
                      ? t("deliverSheet.photoReplace")
                      : t("deliverSheet.photoTake")}
                </Button>
              </div>

              <div className="mt-1 flex gap-2">
                <Button variant="outline" className="h-11 flex-1" onClick={resetSheet} disabled={busy}>
                  {tRoot("common.back")}
                </Button>
                <Button
                  className="h-11 flex-[2] bg-emerald-600 hover:bg-emerald-700"
                  onClick={handleDeliver}
                  disabled={busy || photoBusy}
                >
                  {t("deliverSheet.confirm")}
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
            <h2 className="text-base font-semibold">{t("actions.cantDeliver")}</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              {t("failSheet.subtitle", { name: stop.customerName })}
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
                  {tStatus(`failureReason.${DELIVERY_FAILURE_REASON_KEY[value]}` as never)}
                </button>
              ))}

              <p className="mt-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("failSheet.thenWhat")}
              </p>
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
                    {tStatus(`nextAction.${NEXT_ACTION_KEY[value]}` as never)}
                  </button>
                ))}
              </div>

              <label className="mt-1 flex flex-col gap-1 text-xs font-medium">
                {t("failSheet.noteLabel")}
                <Input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t("failSheet.notePlaceholder")}
                  className="h-11"
                />
              </label>

              <div className="mt-1 flex gap-2">
                <Button variant="outline" className="h-11 flex-1" onClick={resetSheet} disabled={busy}>
                  {tRoot("common.back")}
                </Button>
                <Button
                  className="h-11 flex-[2]"
                  variant="destructive"
                  onClick={handleFail}
                  disabled={busy || reason === null}
                >
                  {t("failSheet.report")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
