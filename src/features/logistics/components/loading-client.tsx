"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { Check, Search } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import type { DispatchBoardData } from "../types";
import { buildLoadBoard, type LoadJob, type LoadLane } from "../lib/loading-model";
import type { TruckDuty } from "../lib/roster-model";
import { getDispatchBoard, setLoadingClaim, setOrderLoaded } from "../server/dispatch-actions";
import { DriverLine } from "./truck-card";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Link } from "@/i18n/navigation";
import { HenEmptyState } from "@/components/shared/hen-empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableHead, TableHeader } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function kg(value: number): string {
  return value.toFixed(1);
}

/** Spring shared by every layout move on the manifest (matches cart-overlay). */
const laneSpring = { type: "spring", bounce: 0, duration: 0.35 } as const;

type TruckTab = "loading" | "done" | "all";
type LaneStatus = "loading" | "done" | "idle";

function laneStatus(lane: LoadLane): LaneStatus {
  if (lane.totalCount === 0) return "idle";
  if (lane.departed || lane.doneCount === lane.totalCount) return "done";
  return "loading";
}

/** Loaded and planned widths against capacity (or against the day's load). */
function lanePcts(lane: LoadLane): { loadedPct: number; plannedPct: number } {
  const hasCap = lane.capacityKg !== null && lane.capacityKg > 0;
  const loadedPct = hasCap
    ? (lane.loadedPct ?? 0)
    : lane.totalKg > 0
      ? (lane.loadedKg / lane.totalKg) * 100
      : 0;
  return { loadedPct, plannedPct: hasCap ? (lane.plannedPct ?? 0) : 100 };
}

function LaneBar({ lane, className }: { lane: LoadLane; className?: string }) {
  const { loadedPct, plannedPct } = lanePcts(lane);
  return (
    <div className={cn("flex h-1.5 overflow-hidden rounded-full bg-muted", className)}>
      <div
        className={cn(
          "h-full transition-[width] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
          lane.overCapacity ? "bg-destructive" : "bg-primary",
        )}
        style={{ width: `${loadedPct}%` }}
      />
      <div
        className={cn(
          "h-full transition-[width] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
          lane.overCapacity ? "bg-destructive/30" : "bg-primary/25",
        )}
        style={{ width: `${Math.max(0, plannedPct - loadedPct)}%` }}
      />
    </div>
  );
}

/** Loaded weight, then the rest of the day's load, against truck capacity. */
function CapacityBar({ lane }: { lane: LoadLane }) {
  const t = useTranslations("loadingBoard.capacity");
  return (
    <div className="mt-1.5">
      <LaneBar lane={lane} />
      <p className="mt-1 text-xs tabular-nums text-muted-foreground">
        {t("onBoard", { loaded: kg(lane.loadedKg), total: kg(lane.totalKg) })}
        {lane.capacityKg !== null ? (
          lane.overCapacity ? (
            <span className="font-medium text-destructive">
              {t("overCapacityBy", { kg: kg(lane.totalKg - lane.capacityKg) })}
            </span>
          ) : (
            <span>{t("freeOf", { free: kg(lane.freeKg ?? 0), capacity: kg(lane.capacityKg) })}</span>
          )
        ) : null}
      </p>
    </div>
  );
}

function TruckStatusChip({ lane }: { lane: LoadLane }) {
  const t = useTranslations("loadingBoard.trucks");
  const tStatusRun = useTranslations("status.run");
  const status = laneStatus(lane);
  if (status === "idle") {
    return <Badge variant="outline">{t("noLoad")}</Badge>;
  }
  if (status === "done") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-[color:var(--color-success)]/40 tabular-nums text-[color:var(--color-success)]"
      >
        <Check aria-hidden />
        {lane.departed ? tStatusRun("departed") : `${lane.doneCount}/${lane.totalCount}`}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="tabular-nums">
      {lane.doneCount}/{lane.totalCount}
    </Badge>
  );
}

function TruckNavButton({
  lane,
  selected,
  onSelect,
}: {
  lane: LoadLane;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations("loadingBoard.trucks");
  const status = laneStatus(lane);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      aria-label={t("selectAria", { truck: lane.truck.name })}
      className={cn(
        "w-60 shrink-0 snap-start rounded-xl border bg-card p-3 text-left transition-[border-color,background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100 md:w-full",
        selected ? "border-primary/60 ring-1 ring-primary/30" : "hover:border-primary/40",
        status === "idle" && "opacity-70",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-semibold">{lane.truck.name}</span>
        <TruckStatusChip lane={lane} />
      </span>
      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
        {lane.truck.code} · {lane.bayName}
      </span>
      {lane.totalCount > 0 ? (
        <>
          <LaneBar lane={lane} className="mt-2" />
          <span className="mt-1 block text-[11px] tabular-nums text-muted-foreground">
            {kg(lane.loadedKg)} / {kg(lane.totalKg)} kg
          </span>
        </>
      ) : null}
    </button>
  );
}

function StatusBadge({
  job,
  isNext,
  organizationSlug,
}: {
  job: LoadJob;
  isNext: boolean;
  organizationSlug: string;
}) {
  const t = useTranslations("loadingBoard.manifest");
  const tJob = useTranslations("loadingBoard.job");
  if (job.loaded) {
    return (
      <span className="inline-flex flex-col items-start gap-0.5">
        <Badge
          variant="outline"
          className="gap-1 border-[color:var(--color-success)]/40 text-[color:var(--color-success)]"
        >
          <Check aria-hidden />
          {t("statusOnBoard")}
        </Badge>
        {job.loadedByName ? (
          <span className="text-[11px] text-muted-foreground">
            {tJob("byName", { name: job.loadedByName })}
          </span>
        ) : null}
      </span>
    );
  }
  if (job.claim) {
    return (
      <Badge
        variant="outline"
        className="border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300"
      >
        {job.claim.mine
          ? tJob("claimedByYou")
          : tJob("claimedBy", { name: job.claim.name ?? tJob("workerFallback") })}
      </Badge>
    );
  }
  if (!job.weighed) {
    return (
      <Badge
        asChild
        variant="outline"
        className="border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950"
      >
        <Link href={`/${organizationSlug}/tasks?order=${job.ticket.id}`}>
          {tJob("notWeighedYet")}
        </Link>
      </Badge>
    );
  }
  if (isNext) return <Badge>{tJob("next")}</Badge>;
  return <Badge variant="outline">{t("statusQueued")}</Badge>;
}

function ManifestRow({
  job,
  isNext,
  departed,
  disabled,
  organizationSlug,
  onToggle,
  onClaim,
}: {
  job: LoadJob;
  isNext: boolean;
  departed: boolean;
  disabled: boolean;
  organizationSlug: string;
  onToggle: (loaded: boolean) => void;
  onClaim: (claim: boolean) => void;
}) {
  const t = useTranslations("loadingBoard.manifest");
  const tJob = useTranslations("loadingBoard.job");
  const tPlan = useTranslations("logistics.dispatch.plan");
  const reduceMotion = useReducedMotion();
  const name = job.ticket.customer?.name ?? tPlan("orderFallback");
  const zoneName = job.ticket.zone?.name ?? null;
  const hasWeight = job.weightKg !== null;

  return (
    <motion.tr
      layout={!reduceMotion}
      transition={laneSpring}
      className={cn("border-b transition-colors", isNext ? "bg-primary/5" : "hover:bg-muted/30")}
    >
      <td className="p-2 align-middle">
        <span
          className={cn(
            "grid size-6 place-items-center rounded-md text-[11px] font-semibold tabular-nums",
            isNext ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          {job.dropNumber}
        </span>
      </td>
      <td className="w-full max-w-0 p-2 align-middle">
        <span
          className={cn(
            "block truncate text-sm font-medium",
            job.loaded && "text-muted-foreground line-through",
          )}
        >
          {name}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground lg:hidden">
          {zoneName ? `${zoneName} · ` : ""}
          {job.slotStart ? `${job.slotStart} · ` : ""}
          {tJob("dropOf", { drop: job.dropNumber, total: job.totalDrops })}
        </span>
        {!job.loaded && !job.weighed && !departed ? (
          <Link
            href={`/${organizationSlug}/tasks?order=${job.ticket.id}`}
            className="mt-0.5 inline-block text-[11px] font-semibold text-amber-700 underline-offset-2 hover:underline dark:text-amber-300 sm:hidden"
          >
            {tJob("notWeighedYet")} — {tJob("weighNow")}
            <span className="sr-only">{tJob("weighNowAria", { name })}</span>
          </Link>
        ) : null}
        {job.claim ? (
          <span className="mt-0.5 block text-[11px] font-semibold text-amber-700 dark:text-amber-300 sm:hidden">
            {job.claim.mine
              ? tJob("claimedByYou")
              : tJob("claimedBy", { name: job.claim.name ?? tJob("workerFallback") })}
          </span>
        ) : null}
      </td>
      <td className="hidden p-2 align-middle text-sm whitespace-nowrap text-muted-foreground lg:table-cell">
        {zoneName ?? "—"}
      </td>
      <td className="hidden p-2 align-middle text-sm tabular-nums whitespace-nowrap text-muted-foreground lg:table-cell">
        {job.slotStart ?? "—"}
      </td>
      <td
        className={cn(
          "p-2 text-right align-middle text-sm font-semibold tabular-nums whitespace-nowrap",
          job.loaded && "font-normal text-muted-foreground line-through",
        )}
      >
        {hasWeight ? `${kg(job.weightKg!)} kg` : "—"}
      </td>
      <td className="hidden p-2 align-middle sm:table-cell">
        <StatusBadge job={job} isNext={isNext} organizationSlug={organizationSlug} />
      </td>
      <td className="p-2 text-right align-middle">
        {departed ? null : job.loaded ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            aria-label={tJob("undoLoadingAria", { name })}
            onClick={() => onToggle(false)}
          >
            {tJob("undo")}
          </Button>
        ) : job.claim?.mine ? (
          <span className="inline-flex items-center justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              aria-label={tJob("cancelClaimAria", { name })}
              onClick={() => onClaim(false)}
            >
              {tJob("cancelClaim")}
            </Button>
            <Button
              size="sm"
              disabled={disabled}
              aria-label={tJob("markLoadedAria", { name })}
              onClick={() => onToggle(true)}
            >
              {t("load")}
            </Button>
          </span>
        ) : job.claim ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            aria-label={tJob("releaseClaimAria", { name })}
            onClick={() => onClaim(false)}
          >
            {tJob("releaseClaim")}
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={disabled || !job.weighed}
            aria-label={job.weighed ? tJob("startLoadingAria", { name }) : tJob("notWeighedYet")}
            onClick={() => onClaim(true)}
          >
            {tJob("start")}
          </Button>
        )}
      </td>
    </motion.tr>
  );
}

function Manifest({
  lane,
  duty,
  pendingIds,
  organizationSlug,
  onToggle,
  onClaim,
}: {
  lane: LoadLane;
  duty: TruckDuty | null;
  pendingIds: ReadonlySet<string>;
  organizationSlug: string;
  onToggle: (orderId: string, loaded: boolean) => void;
  onClaim: (orderId: string, claim: boolean) => void;
}) {
  const t = useTranslations("loadingBoard.manifest");
  const tLane = useTranslations("loadingBoard.lane");
  const tEmpty = useTranslations("loadingBoard.empty");
  const tStatusRun = useTranslations("status.run");
  const [query, setQuery] = useState("");
  const [zone, setZone] = useState("all");

  const zones = useMemo(() => {
    const names = new Set<string>();
    for (const job of lane.jobs) if (job.ticket.zone?.name) names.add(job.ticket.zone.name);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [lane.jobs]);
  const activeZone = zones.includes(zone) ? zone : "all";

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return lane.jobs.filter((job) => {
      if (activeZone !== "all" && job.ticket.zone?.name !== activeZone) return false;
      if (!needle) return true;
      return (job.ticket.customer?.name ?? "").toLowerCase().includes(needle);
    });
  }, [lane.jobs, query, activeZone]);

  const allLoaded = !lane.departed && lane.totalCount > 0 && lane.doneCount === lane.totalCount;

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      aria-label={tLane("ariaLabel", {
        truck: lane.truck.name,
        done: lane.doneCount,
        total: lane.totalCount,
      })}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold leading-tight">{lane.truck.name}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {lane.truck.code} · {lane.bayName}
            {lane.departed ? ` · ${tStatusRun("departed")}` : ""}
            {" · "}
            {t("drops", { count: lane.totalCount })}
          </p>
          <DriverLine duty={duty} className="mt-0.5" />
        </div>
        {allLoaded ? (
          <p className="flex items-center gap-1.5 text-xs font-medium text-[color:var(--color-success)] animate-in fade-in duration-300 motion-reduce:animate-none">
            <Check aria-hidden className="size-3.5" />
            {tLane("allLoaded")}
          </p>
        ) : null}
      </header>
      {lane.totalCount > 0 ? <CapacityBar lane={lane} /> : null}

      {lane.departed ? (
        <p className="mt-3 text-sm text-muted-foreground">{tLane("departedNotice")}</p>
      ) : null}

      {lane.totalCount === 0 ? (
        <HenEmptyState title={tEmpty("noLoadTitle")} subtitle={tEmpty("subtitle")} className="py-14" />
      ) : (
        <>
          {lane.jobs.length > 1 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="relative w-full max-w-60">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("searchPlaceholder")}
                  aria-label={t("searchPlaceholder")}
                  className="pl-8"
                />
              </div>
              {zones.length > 1 ? (
                <Select value={activeZone} onValueChange={setZone}>
                  <SelectTrigger size="sm" aria-label={t("zoneLabel")} className="w-auto min-w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("zoneAll")}</SelectItem>
                    {zones.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-y-contain rounded-xl border [scrollbar-gutter:stable]">
            <Table>
              <TableHeader>
                <TableRowPlain>
                  <TableHead className="w-10 px-2">{t("colSeq")}</TableHead>
                  <TableHead className="px-2">{t("colCustomer")}</TableHead>
                  <TableHead className="hidden px-2 lg:table-cell">{t("colZone")}</TableHead>
                  <TableHead className="hidden px-2 lg:table-cell">{t("colWindow")}</TableHead>
                  <TableHead className="px-2 text-right">{t("colWeight")}</TableHead>
                  <TableHead className="hidden px-2 sm:table-cell">{t("colStatus")}</TableHead>
                  <TableHead className="px-2 text-right">
                    <span className="sr-only">{t("colAction")}</span>
                  </TableHead>
                </TableRowPlain>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-sm text-muted-foreground">
                      {t("noResults")}
                    </td>
                  </tr>
                ) : (
                  rows.map((job) => (
                    <ManifestRow
                      key={job.ticket.id}
                      job={job}
                      isNext={job.ticket.id === lane.nextJobId}
                      departed={lane.departed}
                      disabled={pendingIds.has(job.ticket.id)}
                      organizationSlug={organizationSlug}
                      onToggle={(loaded) => onToggle(job.ticket.id, loaded)}
                      onClaim={(claim) => onClaim(job.ticket.id, claim)}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </section>
  );
}

/** Header row without the hover/selected styling of TableRow. */
function TableRowPlain(props: ComponentProps<"tr">) {
  return <tr className="border-b" {...props} />;
}

export function LoadingClient({
  organizationSlug,
  orgId,
  viewerId,
  initialDate,
  initialData,
}: {
  organizationSlug: string;
  orgId: string;
  viewerId: string;
  initialDate: string;
  initialData: DispatchBoardData;
}) {
  const date = initialDate; // loading is always today
  const tEmpty = useTranslations("loadingBoard.empty");
  const tToast = useTranslations("loadingBoard.toast");
  const tSummary = useTranslations("loadingBoard.summary");
  const tTrucks = useTranslations("loadingBoard.trucks");
  const tLogistics = useTranslations("logistics");
  const tPlan = useTranslations("logistics.dispatch.plan");
  const tSetupToasts = useTranslations("logistics.setup.toasts");
  const tDash = useTranslations("dashboard.pages");
  const format = useFormatter();
  const [data, setData] = useState(initialData);
  const { toast } = useToast();

  // Guards for optimistic toggles: pendingRef blocks double-fires on the same
  // order, inFlightRef keeps a refetch from clobbering a newer optimistic flip.
  const pendingRef = useRef(new Set<string>());
  const inFlightRef = useRef(0);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());

  const setLoadedLocal = useCallback((orderId: string, loaded: boolean) => {
    setData((prev) => ({
      ...prev,
      orders: prev.orders.map((order) =>
        order.id === orderId
          ? {
              ...order,
              loaded_at: loaded ? new Date().toISOString() : null,
              loading_claimed_by: null,
              loading_claimed_at: null,
            }
          : order,
      ),
    }));
  }, []);

  const setClaimLocal = useCallback(
    (orderId: string, claim: boolean) => {
      setData((prev) => ({
        ...prev,
        orders: prev.orders.map((order) =>
          order.id === orderId
            ? {
                ...order,
                loading_claimed_by: claim ? viewerId : null,
                loading_claimed_at: claim ? new Date().toISOString() : null,
              }
            : order,
        ),
      }));
    },
    [viewerId],
  );

  const refetch = useCallback(async () => {
    const result = await getDispatchBoard(organizationSlug, date);
    if (inFlightRef.current > 0) return; // stale — a newer toggle is mid-flight
    if (result.ok) setData(result.data);
    else toast({ title: tLogistics("error"), description: result.message, variant: "destructive" });
  }, [organizationSlug, date, toast, tLogistics]);

  /** Optimistic write: flip locally, confirm with the server, reconcile after. */
  const applyLoaded = useCallback(
    async (orderId: string, loaded: boolean): Promise<boolean> => {
      if (pendingRef.current.has(orderId)) return false;
      pendingRef.current.add(orderId);
      setPendingIds(new Set(pendingRef.current));
      inFlightRef.current += 1;
      setLoadedLocal(orderId, loaded);
      try {
        const result = await setOrderLoaded(organizationSlug, { orderId, loaded });
        if (!result.ok) {
          setLoadedLocal(orderId, !loaded);
          toast({ title: tToast("couldNotUpdateTitle"), description: result.message, variant: "destructive" });
        }
        return result.ok;
      } catch {
        setLoadedLocal(orderId, !loaded);
        toast({ title: tToast("couldNotUpdateTitle"), variant: "destructive" });
        return false;
      } finally {
        pendingRef.current.delete(orderId);
        setPendingIds(new Set(pendingRef.current));
        inFlightRef.current -= 1;
        if (inFlightRef.current === 0) void refetch();
      }
    },
    [organizationSlug, refetch, setLoadedLocal, toast, tToast],
  );

  /** Optimistic claim: same pending/refetch dance as applyLoaded. */
  const applyClaim = useCallback(
    async (orderId: string, claim: boolean): Promise<void> => {
      if (pendingRef.current.has(orderId)) return;
      pendingRef.current.add(orderId);
      setPendingIds(new Set(pendingRef.current));
      inFlightRef.current += 1;
      setClaimLocal(orderId, claim);
      try {
        const result = await setLoadingClaim(organizationSlug, { orderId, claim });
        if (!result.ok) {
          setClaimLocal(orderId, !claim);
          toast({ title: tToast("couldNotUpdateTitle"), description: result.message, variant: "destructive" });
        }
      } catch {
        setClaimLocal(orderId, !claim);
        toast({ title: tToast("couldNotUpdateTitle"), variant: "destructive" });
      } finally {
        pendingRef.current.delete(orderId);
        setPendingIds(new Set(pendingRef.current));
        inFlightRef.current -= 1;
        if (inFlightRef.current === 0) void refetch();
      }
    },
    [organizationSlug, refetch, setClaimLocal, toast, tToast],
  );

  // Other loaders' writes land here live; a short debounce coalesces the
  // burst a single action can emit, and refetch() already ignores results
  // that would clobber a toggle mid-flight.
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const channel = supabase
      .channel(`loading-board-${orgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `organization_id=eq.${orgId}` },
        () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => void refetchRef.current(), 400);
        },
      );
    // The browser client starts realtime with the anon key; RLS rejects the
    // subscription until the user token is set, so wait for the session first.
    void supabase.auth.getSession().then(({ data }) => {
      if (disposed) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      channel.subscribe((status, err) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error(`realtime ${status}`, err);
        }
      });
    });
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [orgId]);

  // Claims expire client-side too: tick once a minute so a stale amber chip
  // falls back to "Start" even with no board traffic.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const toggle = useCallback(
    (orderId: string, loaded: boolean, name?: string) => {
      void (async () => {
        const ok = await applyLoaded(orderId, loaded);
        if (!ok || !loaded) return;
        toast({
          title: tToast("loadedTitle", { name: name ?? tPlan("orderFallback") }),
          action: (
            <ToastAction
              altText={tSetupToasts("undo")}
              onClick={() => void applyLoaded(orderId, false)}
            >
              {tSetupToasts("undo")}
            </ToastAction>
          ),
        });
      })();
    },
    [applyLoaded, toast, tToast, tPlan, tSetupToasts],
  );

  const lanes = useMemo(
    () => buildLoadBoard(data, date, { viewerId, nowMs }),
    [data, date, viewerId, nowMs],
  );

  const counts = useMemo(() => {
    const byStatus = { loading: 0, done: 0, idle: 0 };
    for (const lane of lanes) byStatus[laneStatus(lane)] += 1;
    return byStatus;
  }, [lanes]);

  // Sidebar selection: default to the first truck still loading, else first.
  const [tabChoice, setTabChoice] = useState<TruckTab | null>(null);
  const tab: TruckTab = tabChoice ?? (counts.loading > 0 ? "loading" : "all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    lanes.find((lane) => lane.truck.id === selectedId) ??
    lanes.find((lane) => laneStatus(lane) === "loading") ??
    lanes[0] ??
    null;

  const navLanes = useMemo(() => {
    // Working trucks first, then done, then idle — bay order preserved inside.
    const order: LaneStatus[] = ["loading", "done", "idle"];
    const sorted = [...lanes].sort(
      (a, b) => order.indexOf(laneStatus(a)) - order.indexOf(laneStatus(b)),
    );
    if (tab === "all") return sorted;
    return sorted.filter((lane) => laneStatus(lane) === tab);
  }, [lanes, tab]);

  const totals = useMemo(() => {
    const working = lanes.filter((lane) => lane.totalCount > 0);
    return working.reduce(
      (acc, lane) => ({
        done: acc.done + lane.doneCount,
        total: acc.total + lane.totalCount,
        trucks: acc.trucks + 1,
      }),
      { done: 0, total: 0, trucks: 0 },
    );
  }, [lanes]);

  const nameFor = useCallback(
    (orderId: string) =>
      lanes
        .flatMap((lane) => lane.jobs)
        .find((job) => job.ticket.id === orderId)?.ticket.customer?.name,
    [lanes],
  );

  // Noon Kuala Lumpur pins the calendar day no matter what timezone the
  // server or browser runs in; the formatter is already zoned to KL.
  const dateLabel = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? format.dateTime(new Date(`${date}T12:00:00+08:00`), {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : date;

  if (lanes.length === 0) {
    return (
      <div className="flex w-full flex-1 flex-col">
        <h1 className="text-lg font-semibold">{tDash("loading")}</h1>
        <HenEmptyState title={tEmpty("title")} subtitle={tEmpty("subtitle")} className="flex-1 py-20" />
      </div>
    );
  }

  const boardComplete = totals.total > 0 && totals.done === totals.total;

  return (
    <div className="flex w-full flex-col gap-4 md:h-[calc(100svh-7rem)]">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold">{tDash("loading")}</h1>
          <p className="text-xs text-muted-foreground">{dateLabel}</p>
          {totals.total > 0 ? (
            <p role="status" aria-live="polite" className="text-xs tabular-nums text-muted-foreground">
              {tSummary("loadedAcross", { done: totals.done, total: totals.total, count: totals.trucks })}
            </p>
          ) : null}
        </div>
        {totals.total > 0 ? (
          <div aria-hidden className="h-1 w-full max-w-sm overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-[width,background-color] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
                boardComplete ? "bg-[color:var(--color-success)]" : "bg-primary",
              )}
              style={{ width: `${(totals.done / totals.total) * 100}%` }}
            />
          </div>
        ) : null}
      </header>

      {totals.total === 0 ? (
        <HenEmptyState title={tEmpty("noLoadTitle")} subtitle={tEmpty("subtitle")} className="py-14" />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 md:grid md:grid-cols-[264px_minmax(0,1fr)] md:items-stretch md:gap-6">
          <nav aria-label={tTrucks("title")} className="flex min-h-0 flex-col gap-2">
            <Tabs value={tab} onValueChange={(value) => setTabChoice(value as TruckTab)}>
              <TabsList className="w-full">
                <TabsTrigger value="loading" className="flex-1 tabular-nums">
                  {tTrucks("tabLoading")} · {counts.loading}
                </TabsTrigger>
                <TabsTrigger value="done" className="flex-1 tabular-nums">
                  {tTrucks("tabDone")} · {counts.done}
                </TabsTrigger>
                <TabsTrigger value="all" className="flex-1 tabular-nums">
                  {tTrucks("tabAll")} · {lanes.length}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {navLanes.length === 0 ? (
              <p className="px-1 py-2 text-xs text-muted-foreground">{tTrucks("emptyTab")}</p>
            ) : (
              <div className="-mx-1 flex snap-x gap-2 overflow-x-auto overscroll-x-contain px-1 pb-1 md:mx-0 md:min-h-0 md:flex-1 md:flex-col md:overflow-x-hidden md:overflow-y-auto md:overscroll-y-contain md:px-0 md:pr-1 md:pb-0 [scrollbar-gutter:stable]">
                {navLanes.map((lane) => (
                  <TruckNavButton
                    key={lane.truck.id}
                    lane={lane}
                    selected={selected?.truck.id === lane.truck.id}
                    onSelect={() => setSelectedId(lane.truck.id)}
                  />
                ))}
              </div>
            )}
          </nav>

          {selected ? (
            <Manifest
              key={selected.truck.id}
              lane={selected}
              duty={data.duties[selected.truck.id] ?? null}
              pendingIds={pendingIds}
              organizationSlug={organizationSlug}
              onToggle={(orderId, loaded) => toggle(orderId, loaded, nameFor(orderId))}
              onClaim={(orderId, claim) => void applyClaim(orderId, claim)}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
