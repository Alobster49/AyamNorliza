"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  arriveStop,
  deliverStop,
  failStop,
  finishRun,
  getDriverRun,
  startRun,
} from "@/features/orders/server/driver-actions";
import {
  DELIVERY_FAILURE_REASON_KEY,
  DELIVERY_FAILURE_REASONS,
  DELIVERY_NEXT_ACTIONS,
  type DeliveryFailureReason,
  type DeliveryNextAction,
  type RunWithOrders,
} from "@/features/orders/types";
import { buildDriverDeck, linesTotal, type DriverStop } from "@/features/orders/lib/driver-run-model";
import { departureCheck } from "@/features/orders/lib/run-board-model";
import { formatPrice, formatWeight } from "@/features/orders/lib/order-model";
import { DriverSignOutButton } from "@/features/orders/components/driver-sign-out";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CalendarDays, MessageCircle, Navigation, Phone } from "lucide-react";
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

/** Every stop on the run, with an Invoice link for the delivered ones. Shared by
 * the in-progress "whole route" details and the finished screen -- the finished
 * screen has no `<details>` to nest inside, so it renders the same list bare. */
function StopList({
  stops,
  organizationSlug,
  showUnloaded = false,
  t,
}: {
  stops: DriverStop[];
  organizationSlug: string;
  /** Tag stops the loading screen has not signed off. Only useful pre-departure. */
  showUnloaded?: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <ul className="divide-y">
      {stops.map((item) => (
        <li key={item.orderId} className="flex items-center justify-between gap-3 px-4 py-2">
          <span className="min-w-0 text-sm">
            <span className="mr-1.5 text-xs tabular-nums text-muted-foreground">{item.sequence}</span>
            {item.customerName}
          </span>
          {item.outcome === "delivered" ? (
            <Link
              href={`/drive/${organizationSlug}/invoice/${item.orderId}`}
              className="-my-2 shrink-0 rounded-md p-2 text-[11px] font-medium underline underline-offset-2"
            >
              {t("stopStatus.invoice")}
            </Link>
          ) : (
            <span
              className={`shrink-0 text-[11px] ${
                showUnloaded && item.outcome === "pending" && !item.loaded
                  ? "font-medium text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground"
              }`}
            >
              {item.outcome === "failed"
                ? t("stopStatus.failed")
                : item.outcome === "cancelled"
                  ? t("stopStatus.cancelled")
                  : item.atStop
                    ? t("stopStatus.hereNow")
                    : showUnloaded && !item.loaded
                      ? t("stopStatus.notLoaded")
                      : t("stopStatus.toDo")}
            </span>
          )}
        </li>
      ))}
    </ul>
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
  const router = useRouter();
  const [run, setRun] = useState(initialRun);
  const [sheet, setSheet] = useState<Sheet>("none");
  const [busy, startTransition] = useTransition();
  const [receivedBy, setReceivedBy] = useState("");
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [pieces, setPieces] = useState<Record<string, string>>({});
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [reason, setReason] = useState<DeliveryFailureReason | null>(null);
  const [nextAction, setNextAction] = useState<DeliveryNextAction>("retry_today");
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  // The whole-route list is a closed disclosure on a phone (screen real estate)
  // but there is room for it beside the stop on desktop, so open it there.
  // Starts closed so the server and first client render agree.
  const [openRoute, setOpenRoute] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const sync = (event: MediaQueryList | MediaQueryListEvent) => setOpenRoute(event.matches);
    sync(query);
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // A driver on a phone dismisses by tapping the backdrop; Escape is for the
  // office opening the same deck with ?run= on a laptop.
  useEffect(() => {
    if (sheet === "none") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") resetSheet();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);

  const deck = useMemo(() => buildDriverDeck(run), [run]);
  const stop = deck.current;
  // Read against driver_start_run, not the office depart: this screen has no
  // "leave it behind" dialog, so every stop must be ready and signed off.
  const gate = useMemo(() => departureCheck(run, "driver"), [run]);

  // While the run is still in the yard the loading bay is the one moving
  // state forward, so poll — the deck unblocks itself when they finish.
  useEffect(() => {
    if (run.status !== "planned") return;
    const id = window.setInterval(() => {
      void getDriverRun(organizationSlug, run.id).then((result) => {
        // Errors stay silent: a toast every poll tick would bury the screen.
        if (result.ok && result.data.run) setRun(result.data.run);
      });
    }, 15_000);
    return () => window.clearInterval(id);
  }, [organizationSlug, run.id, run.status]);

  const weightEntries = (stop?.items ?? []).map((item) => {
    const raw = weights[item.itemId]?.trim() ?? "";
    const parsed = raw === "" ? null : Number(raw);
    const valid = parsed !== null && Number.isFinite(parsed) && parsed > 0;
    return { item, raw, weightKg: valid ? parsed : null, valid };
  });
  const allWeightsValid = weightEntries.length > 0 && weightEntries.every((entry) => entry.valid);
  const liveTotal = linesTotal(
    weightEntries.map((entry) => ({ weightKg: entry.weightKg, pricePerKg: entry.item.pricePerKg })),
  );

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
    setPhotoPath(null);
    setReason(null);
    setNote("");
    setNextAction("retry_today");
    setWeights({});
    setPieces({});
  }

  function handleStartRun() {
    startTransition(async () => {
      const result = await startRun(organizationSlug, run.id);
      if (!result.ok) {
        toast({
          title: t("toast.startRunFailedTitle"),
          description: result.messageKey ? tRoot(result.messageKey as never) : result.message,
          variant: "destructive",
        });
        return;
      }
      toast({ title: t("toast.startedTitle") });
      await refresh();
    });
  }

  /** Close the run from the truck. Stops that were never delivered go back to
   * the office pool -- the driver is saying "I am done", not "everything I did
   * not touch went out". */
  async function handleFinishRun() {
    const result = await finishRun(organizationSlug, run.id);
    if (!result.ok) {
      toast({
        title: t("toast.finishFailedTitle"),
        description: result.messageKey ? tRoot(result.messageKey as never) : result.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: t("toast.finishedTitle") });
    router.replace(`/drive/${organizationSlug}`);
    router.refresh();
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
    if (!allWeightsValid) {
      toast({
        title: t("toast.weightsMissingTitle"),
        description: tRoot("errors.drive.stop.weightsMissing" as never),
        variant: "destructive",
      });
      return;
    }

    startTransition(async () => {
      const result = await deliverStop(organizationSlug, stop.orderId, {
        receivedBy: receivedBy.trim() || null,
        photoPath,
        // Cash is settled in the office, not at the door: the driver never keys it.
        cashCollected: null,
        lines: weightEntries.map(({ item, weightKg }) => {
          const piecesRaw = pieces[item.itemId]?.trim() ?? "";
          const parsedPieces = piecesRaw === "" ? null : Number.parseInt(piecesRaw, 10);
          return {
            itemId: item.itemId,
            finalWeightKg: weightKg as number,
            finalPieces: parsedPieces !== null && Number.isInteger(parsedPieces) && parsedPieces >= 0 ? parsedPieces : null,
          };
        }),
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
      <header className="sticky top-0 z-10 border-b bg-background/85 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base font-semibold">
              {stop ? t("header.stopOf", { sequence: stop.sequence, total: deck.total }) : t("header.runFinished")}
            </h1>
            <p className="text-xs text-muted-foreground">
              {deck.truckLabel ?? t("truckFallback")} · {t("header.remaining", { count: deck.remaining })}
              {deck.failed > 0 ? ` · ${t("header.toSortOut", { count: deck.failed })}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {/* Small, unobtrusive — the deck's job is the run, not HR. Drivers
                now open the seller shell for leave (the (seller) layout admits
                any active member), so this is their only way in from here. */}
            <Button variant="ghost" size="sm" className="h-9 gap-1.5" asChild>
              <Link href={`/${organizationSlug}/leave`}>
                <CalendarDays className="size-4" aria-hidden />
                <span className="sr-only sm:not-sr-only">{tRoot("hr.nav.myLeave")}</span>
              </Link>
            </Button>
            <DriverSignOutButton className="h-11 min-w-11" />
          </div>
        </div>
        <div className="mt-2">
          <Bar pct={deck.progressPct} />
        </div>
      </header>

      {!stop ? (
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-3 overflow-y-auto px-4 py-6 text-center sm:py-10">
          <p className="text-lg font-semibold">{t("finished.title")}</p>
          <p className="text-sm text-muted-foreground">
            {t("finished.delivered", { count: deck.delivered })}
            {deck.failed > 0 ? `, ${t("finished.couldNotDeliver", { count: deck.failed })}` : ""}.{" "}
            {t("finished.wrapUp")}
          </p>
          <p className="text-xs text-muted-foreground">{t("finished.invoiceHint")}</p>
          {deck.runStatus === "departed" && (
            <div className="flex w-full flex-col items-center gap-1.5">
              <Button
                size="lg"
                className="h-12 w-full max-w-sm text-base"
                disabled={busy}
                onClick={() => setConfirmClose(true)}
              >
                {t("closeRun.button")}
              </Button>
              <p className="text-xs text-muted-foreground">{t("finished.closeHint")}</p>
            </div>
          )}
          <section className="w-full overflow-hidden rounded-xl border bg-card text-left">
            <StopList stops={deck.stops} organizationSlug={organizationSlug} t={t} />
          </section>
        </div>
      ) : (
        <main
          className={
            "flex flex-1 flex-col gap-3 p-3 sm:p-4 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6 lg:p-6 " +
            // Clear the fixed action bar so the route list is never trapped under it.
            (deck.runStatus === "planned" ? "" : "max-lg:pb-36")
          }
        >
          {/* The stop */}
          <section className="overflow-hidden rounded-2xl border bg-card shadow-sm lg:col-start-1 lg:row-start-1">
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
                  className={`flex min-h-14 flex-col items-center justify-center rounded-xl border bg-background text-xs font-medium ${
                    stop.phone ? "" : "pointer-events-none opacity-40"
                  }`}
                >
                  <Phone className="mb-1 h-4 w-4" aria-hidden="true" />
                  {t("actions.call")}
                </a>
                <a
                  href={mapsHref(stop)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-14 flex-col items-center justify-center rounded-xl border bg-background text-xs font-medium"
                >
                  <Navigation className="mb-1 h-4 w-4" aria-hidden="true" />
                  {t("actions.navigate")}
                </a>
                <a
                  href={stop.phone ? `https://wa.me/${stop.phone.replace(/[^0-9]/g, "")}` : undefined}
                  aria-disabled={!stop.phone}
                  target="_blank"
                  rel="noreferrer"
                  className={`flex min-h-14 flex-col items-center justify-center rounded-xl border bg-background text-xs font-medium ${
                    stop.phone ? "" : "pointer-events-none opacity-40"
                  }`}
                >
                  <MessageCircle className="mb-1 h-4 w-4" aria-hidden="true" />
                  {t("actions.whatsapp")}
                </a>
              </div>
            </div>

            {/* Actions */}
            {deck.runStatus === "planned" && (
              <div className="flex flex-col gap-2 p-4">
                {gate.canDepart ? (
                  <p className="text-center text-xs text-muted-foreground">{t("startRun.hint")}</p>
                ) : (
                  <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950 dark:text-amber-200">
                    <p className="font-semibold">{t("startRun.blockedTitle")}</p>
                    {gate.unloaded.length > 0 && (
                      <p className="mt-1">
                        {t("startRun.blockedNotLoaded", {
                          count: gate.unloaded.length,
                          list: gate.unloaded.map((o) => o.label).join(", "),
                        })}
                      </p>
                    )}
                    {gate.unweighed.length > 0 && (
                      <p className="mt-1">
                        {t("startRun.blockedUnweighed", {
                          list: gate.unweighed.map((o) => o.label).join(", "),
                        })}
                      </p>
                    )}
                    <p className="mt-1 text-amber-700 dark:text-amber-300">{t("startRun.blockedHint")}</p>
                  </div>
                )}
                <Button
                  size="lg"
                  className="h-12 w-full text-base"
                  disabled={busy || !gate.canDepart}
                  onClick={handleStartRun}
                >
                  {t("startRun.button")}
                </Button>
              </div>
            )}
          </section>

          {/* The two calls a driver makes at every door. On a phone they are
              pinned above the thumb — a long address or note used to push them
              below the fold, which is the one place scrolling is unacceptable. */}
          {deck.runStatus !== "planned" && (
            <div className="fixed inset-x-0 bottom-0 z-20 flex flex-col gap-2 border-t bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:static lg:z-auto lg:col-start-1 lg:row-start-2 lg:rounded-2xl lg:border lg:bg-card lg:p-4 lg:backdrop-blur-none">
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
          )}

          {/* Orientation rail: on phones it stacks under the stop, on desktop it
              sits beside it so the driver never scrolls past the actions. */}
          <aside className="flex flex-col gap-3 lg:col-start-2 lg:row-start-1 lg:row-span-2">
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
            <details
              className="rounded-xl border bg-card"
              open={openRoute}
              onToggle={(event) => setOpenRoute(event.currentTarget.open)}
            >
              <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">
                {t("wholeRun.summary", { delivered: deck.delivered, total: deck.total })}
              </summary>
              <div className="border-t">
                <StopList
                  stops={deck.stops}
                  organizationSlug={organizationSlug}
                  showUnloaded={deck.runStatus === "planned"}
                  t={t}
                />
              </div>
            </details>

            {deck.runStatus === "departed" && (
              <Button
                variant="outline"
                className="h-11 w-full"
                disabled={busy}
                onClick={() => setConfirmClose(true)}
              >
                {t("closeRun.endEarly")}
              </Button>
            )}
          </aside>
        </main>
      )}

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title={t("closeRun.confirmTitle")}
        description={
          deck.remaining > 0
            ? t("closeRun.confirmRemaining", { count: deck.remaining })
            : t("closeRun.confirmDone")
        }
        confirmLabel={t("closeRun.button")}
        onConfirm={handleFinishRun}
      />

      {/* Proof of delivery */}
      {sheet === "deliver" && stop && (
        <div
          className="fixed inset-0 z-30 flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-6"
          role="dialog"
          aria-modal="true"
          // Tapping the strip of backdrop above the sheet dismisses it, like Escape does.
          onClick={(event) => {
            if (event.target === event.currentTarget) resetSheet();
          }}
        >
          <div className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl border-t bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-lg sm:rounded-2xl sm:border sm:pb-4">
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-muted sm:hidden" />
            <h2 className="text-base font-semibold">{t("deliverSheet.title")}</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              {t("deliverSheet.subtitle", { name: stop.customerName })}
            </p>

            <div className="flex flex-col gap-3">
              {weightEntries.map(({ item, raw }) => (
                <label key={item.itemId} className="flex flex-col gap-1 text-xs font-medium">
                  <span>
                    {item.productName ?? t("deliverSheet.itemFallback")}
                    {item.pricePerKg !== null ? ` · ${formatPrice(item.pricePerKg)}/kg` : ""}
                  </span>
                  <div className="flex gap-2">
                    <Input
                      value={raw}
                      onChange={(event) =>
                        setWeights((prev) => ({ ...prev, [item.itemId]: event.target.value }))
                      }
                      inputMode="decimal"
                      placeholder={
                        item.warehouseWeightKg !== null
                          ? t("deliverSheet.weightPlaceholderKg", { weight: item.warehouseWeightKg })
                          : t("deliverSheet.weightPlaceholder")
                      }
                      className="h-11 flex-[2]"
                    />
                    {item.mode === "piece" && (
                      <Input
                        value={pieces[item.itemId] ?? ""}
                        onChange={(event) =>
                          setPieces((prev) => ({ ...prev, [item.itemId]: event.target.value }))
                        }
                        inputMode="numeric"
                        placeholder={t("deliverSheet.piecesPlaceholder", { count: item.quantity })}
                        className="h-11 flex-1"
                      />
                    )}
                  </div>
                </label>
              ))}

              <div className="flex items-center justify-between rounded-xl bg-accent/40 px-3 py-2">
                <span className="text-xs font-medium">{t("deliverSheet.liveTotal")}</span>
                <span className="text-base font-semibold tabular-nums">{formatPrice(liveTotal)}</span>
              </div>

              <label className="flex flex-col gap-1 text-xs font-medium">
                {t("deliverSheet.receivedByLabel")}
                <Input
                  value={receivedBy}
                  onChange={(event) => setReceivedBy(event.target.value)}
                  placeholder={t("deliverSheet.receivedByPlaceholder")}
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
                  disabled={busy || photoBusy || !allWeightsValid}
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
        <div
          className="fixed inset-0 z-30 flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-6"
          role="dialog"
          aria-modal="true"
          // Tapping the strip of backdrop above the sheet dismisses it, like Escape does.
          onClick={(event) => {
            if (event.target === event.currentTarget) resetSheet();
          }}
        >
          <div className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl border-t bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-lg sm:rounded-2xl sm:border sm:pb-4">
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-muted sm:hidden" />
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
