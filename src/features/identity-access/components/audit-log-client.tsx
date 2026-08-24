"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  ChevronRight,
  Filter,
  Search,
  ShieldAlert,
  Tag,
  User as UserIcon,
  X,
} from "lucide-react";

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
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

import type { AuditLogEntry } from "@/features/identity-access/types";

type Props = {
  rows: AuditLogEntry[];
  filters: {
    eventTypes: string[];
    entityTypes: string[];
    sources: string[];
  };
  active: {
    eventType: string;
    entityType: string;
    source: string;
    query: string;
    rowId: string;
  };
};

type Bucket = { key: string; label: string; rows: AuditLogEntry[] };

const ANY = "__any__";

function classify(eventType: string): {
  labelKey: "removal" | "anomaly" | "privileged" | "change" | "auth" | "event";
  tone: "neutral" | "danger" | "warn" | "ok" | "info";
} {
  const e = eventType.toLowerCase();
  if (e.includes("delete") || e.includes("deactiv") || e.includes("revoke"))
    return { labelKey: "removal", tone: "danger" };
  if (e.includes("suspicious") || e.includes("failure"))
    return { labelKey: "anomaly", tone: "danger" };
  if (e.includes("break_glass") || e.includes("support"))
    return { labelKey: "privileged", tone: "warn" };
  if (
    e.includes("role_changed") ||
    e.includes("scope_changed") ||
    e.includes("invited") ||
    e.includes("access_review")
  )
    return { labelKey: "change", tone: "info" };
  if (e.includes("login") || e.includes("session"))
    return { labelKey: "auth", tone: "neutral" };
  return { labelKey: "event", tone: "neutral" };
}

function toneClasses(tone: ReturnType<typeof classify>["tone"]) {
  switch (tone) {
    case "danger":
      return "bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20";
    case "warn":
      return "bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-300";
    case "info":
      return "bg-sky-500/10 text-sky-700 ring-1 ring-inset ring-sky-500/20 dark:text-sky-300";
    case "ok":
      return "bg-emerald-500/10 text-emerald-700 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-300";
    default:
      return "bg-muted text-muted-foreground ring-1 ring-inset ring-border";
  }
}

function bucketize(rows: AuditLogEntry[]): Bucket[] {
  const groups = new Map<string, { day: Date; rows: AuditLogEntry[] }>();
  for (const r of rows) {
    const d = new Date(r.occurredAt);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const key = day.toISOString();
    if (!groups.has(key)) {
      groups.set(key, { day, rows: [] });
    }
    groups.get(key)!.rows.push(r);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([key, value]) => ({ key, label: key, rows: value.rows }));
}

function bucketDay(key: string): Date {
  return new Date(key);
}

function Copyable({ value, copiedLabel }: { value: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [value]);
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onCopy}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onCopy();
        }
      }}
      title={value}
      className="cursor-pointer rounded px-1 font-mono text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
    >
      {copied ? copiedLabel : `${value.slice(0, 8)}…`}
    </span>
  );
}

export function AuditLogClient({ rows, filters, active }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("identity.auditLog");
  const format = useFormatter();
  const [, startTransition] = useTransition();

  const [now] = useState(() => Date.now());

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!value) params.delete(key);
      else params.set(key, value);
      const qs = params.toString();
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  const filtered = useMemo(() => {
    const q = active.query.trim().toLowerCase();
    return rows.filter((r) => {
      if (active.eventType && r.eventType !== active.eventType) return false;
      if (active.entityType && r.entityType !== active.entityType) return false;
      if (active.source && r.source !== active.source) return false;
      if (q) {
        const hay = [
          r.eventType,
          r.entityType,
          r.entityId ?? "",
          r.actorUserId ?? "",
          r.reason ?? "",
          r.source,
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, active]);

  const buckets = useMemo(() => bucketize(filtered), [filtered]);
  const flatRows = useMemo(() => buckets.flatMap((b) => b.rows), [buckets]);
  const selected = useMemo(
    () => flatRows.find((r) => r.id === active.rowId) ?? null,
    [flatRows, active.rowId],
  );

  const activeCount =
    (active.eventType ? 1 : 0) +
    (active.entityType ? 1 : 0) +
    (active.source ? 1 : 0) +
    (active.query ? 1 : 0);

  const clearAll = () => {
    const params = new URLSearchParams();
    if (active.rowId) params.set("row", active.rowId);
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };

  const selectRow = (id: string) =>
    updateParam("row", id === active.rowId ? null : id);
  const closeRow = () => updateParam("row", null);

  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-xl border bg-card shadow-[var(--shadow-sm,0_1px_2px_rgba(0,0,0,0.04))]">
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
          <div className="flex items-center gap-2 pr-2 text-muted-foreground">
            <Filter className="size-4" aria-hidden />
            <span className="text-xs font-medium uppercase tracking-wide">
              {t("filtersLabel")}
            </span>
          </div>

          <Select
            value={active.eventType || ANY}
            onValueChange={(v) => updateParam("eventType", v === ANY ? null : v)}
          >
            <SelectTrigger size="sm" className="min-w-[160px]">
              <SelectValue placeholder={t("eventTypePlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t("allEvents")}</SelectItem>
              {filters.eventTypes.map((e) => (
                <SelectItem key={e} value={e}>
                  {e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={active.entityType || ANY}
            onValueChange={(v) =>
              updateParam("entityType", v === ANY ? null : v)
            }
          >
            <SelectTrigger size="sm" className="min-w-[140px]">
              <SelectValue placeholder={t("entityPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t("allEntities")}</SelectItem>
              {filters.entityTypes.map((e) => (
                <SelectItem key={e} value={e}>
                  {e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={active.source || ANY}
            onValueChange={(v) => updateParam("source", v === ANY ? null : v)}
          >
            <SelectTrigger size="sm" className="min-w-[110px]">
              <SelectValue placeholder={t("sourcePlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t("anySource")}</SelectItem>
              {filters.sources.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative ml-auto w-full sm:w-64">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={active.query}
              onChange={(e) => updateParam("query", e.target.value || null)}
              placeholder={t("searchPlaceholder")}
              className="h-8 pl-7 text-xs"
              spellCheck={false}
            />
          </div>

          {activeCount > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearAll}
              className="h-7 gap-1 px-2 text-xs text-muted-foreground"
            >
              <X className="size-3" />
              {t("clear", { count: activeCount })}
            </Button>
          ) : null}
        </div>

        <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
          <div>
            {t("showing", { shown: filtered.length, total: rows.length })}
          </div>
          <div className="hidden sm:block">
            {t("appendOnlyNote")}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <ol className="space-y-6">
          {buckets.map((bucket) => (
            <li key={bucket.key}>
              <div className="sticky top-0 z-10 -mx-4 mb-3 flex items-baseline gap-3 bg-background/85 px-4 py-1 backdrop-blur supports-[backdrop-filter]:bg-background/65">
                <h2 className="text-sm font-semibold tracking-tight">
                  <BucketLabel day={bucketDay(bucket.key)} />
                </h2>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {t("eventCount", { count: bucket.rows.length })}
                </span>
              </div>
              <ul className="relative ml-3 border-l border-border/70">
                {bucket.rows.map((row) => {
                  const cls = classify(row.eventType);
                  const isOpen = active.rowId === row.id;
                  return (
                    <li key={row.id} className="relative pl-6">
                      <span
                        aria-hidden
                        className={`absolute left-0 top-3.5 inline-block size-2 -translate-x-1/2 rounded-full ring-4 ring-background ${
                          cls.tone === "danger"
                            ? "bg-destructive"
                            : cls.tone === "warn"
                              ? "bg-amber-500"
                              : cls.tone === "info"
                                ? "bg-sky-500"
                                : "bg-muted-foreground/50"
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => selectRow(row.id)}
                        aria-expanded={isOpen}
                        className={`group flex w-full items-start gap-4 rounded-lg border px-3 py-2.5 text-left transition ${
                          isOpen
                            ? "border-foreground/15 bg-muted/60"
                            : "border-transparent hover:border-border hover:bg-muted/40"
                        }`}
                      >
                        <div className="w-20 shrink-0 font-mono text-xs leading-tight text-muted-foreground tabular-nums">
                          <div>{format.dateTime(new Date(row.occurredAt), { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</div>
                          <div className="text-[10px] text-muted-foreground/70">
                            {format.relativeTime(new Date(row.occurredAt), now)}
                          </div>
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${toneClasses(cls.tone)}`}
                            >
                              {t(`classify.${cls.labelKey}`)}
                            </span>
                            <code className="truncate font-mono text-xs">
                              {row.eventType}
                            </code>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <Tag className="size-3" aria-hidden />
                              {row.entityType}
                              {row.entityId ? (
                                <>
                                  {" "}
                                  <Copyable value={row.entityId} copiedLabel={t("copied")} />
                                </>
                              ) : null}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <UserIcon className="size-3" aria-hidden />
                              {row.actorUserId ? (
                                <Copyable value={row.actorUserId} copiedLabel={t("copied")} />
                              ) : (
                                <span>{t("systemActor")}</span>
                              )}
                              {row.actorRole ? (
                                <Badge
                                  variant="outline"
                                  className="h-4 px-1 text-[10px] font-normal"
                                >
                                  {row.actorRole}
                                </Badge>
                              ) : null}
                            </span>
                            {row.reason ? (
                              <span className="truncate italic">
                                “{row.reason}”
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <ChevronRight
                          className={`mt-1 size-4 shrink-0 text-muted-foreground transition ${isOpen ? "rotate-90" : ""}`}
                          aria-hidden
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}

      <Sheet
        open={Boolean(selected)}
        onOpenChange={(o) => {
          if (!o) closeRow();
        }}
      >
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 sm:max-w-xl"
        >
          {selected ? <DetailPanel row={selected} onClose={closeRow} /> : null}
          <SheetTitle className="sr-only">{t("entryTitleSr")}</SheetTitle>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function BucketLabel({ day }: { day: Date }) {
  const t = useTranslations("identity.auditLog");
  const format = useFormatter();
  const today = new Date();
  const isSameDay =
    day.getFullYear() === today.getFullYear() &&
    day.getMonth() === today.getMonth() &&
    day.getDate() === today.getDate();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const isYesterday =
    day.getFullYear() === yesterday.getFullYear() &&
    day.getMonth() === yesterday.getMonth() &&
    day.getDate() === yesterday.getDate();
  if (isSameDay) return <>{t("today")}</>;
  if (isYesterday) return <>{t("yesterday")}</>;
  return (
    <>
      {format.dateTime(day, {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
      })}
    </>
  );
}

function EmptyState() {
  const t = useTranslations("identity.auditLog");
  return (
    <div className="rounded-xl border border-dashed bg-card/50 px-6 py-16 text-center">
      <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <ShieldAlert className="size-5" />
      </div>
      <h3 className="mt-3 text-sm font-semibold">{t("emptyTitle")}</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("emptyBody")}
      </p>
    </div>
  );
}

function DetailPanel({
  row,
  onClose,
}: {
  row: AuditLogEntry;
  onClose: () => void;
}) {
  const t = useTranslations("identity.auditLog");
  const format = useFormatter();
  const cls = classify(row.eventType);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${toneClasses(cls.tone)}`}
            >
              {t(`classify.${cls.labelKey}`)}
            </span>
            <span className="text-xs text-muted-foreground">
              {format.dateTime(new Date(row.occurredAt), { dateStyle: "medium", timeStyle: "medium" })}
            </span>
          </div>
          <h2 className="truncate font-mono text-sm">{row.eventType}</h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label={t("closeDetailAria")}
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <Field label={t("detailEventId")}>
          <code className="break-all font-mono text-xs">{row.id}</code>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("detailEntity")}>
            <div className="text-sm">{row.entityType}</div>
            {row.entityId ? (
              <code className="break-all font-mono text-[11px] text-muted-foreground">
                {row.entityId}
              </code>
            ) : null}
          </Field>
          <Field label={t("detailSource")}>
            <Badge variant="outline">{row.source}</Badge>
          </Field>
          <Field label={t("detailActor")}>
            <div className="font-mono text-xs">
              {row.actorUserId ?? t("systemActor")}
            </div>
            {row.actorRole ? (
              <div className="text-[11px] text-muted-foreground">
                {t("detailActorRole", { role: row.actorRole })}
              </div>
            ) : null}
          </Field>
          {row.correlationId ? (
            <Field label={t("detailCorrelation")}>
              <code className="break-all font-mono text-[11px]">
                {row.correlationId}
              </code>
            </Field>
          ) : (
            <Field label={t("detailReason")}>
              <div className="text-xs italic text-muted-foreground">
                {row.reason ?? t("noValue")}
              </div>
            </Field>
          )}
        </div>

        {row.correlationId && row.reason ? (
          <Field label={t("detailReason")}>
            <div className="text-xs italic text-muted-foreground">
              {row.reason}
            </div>
          </Field>
        ) : null}

        {(row.before !== null && row.before !== undefined) ||
        (row.after !== null && row.after !== undefined) ? (
          <Field label={t("detailChanges")}>
            <div className="grid grid-cols-1 gap-2">
              <DiffBlock label={t("before")} value={row.before} noValue={t("noValue")} />
              <DiffBlock label={t("after")} value={row.after} noValue={t("noValue")} />
            </div>
          </Field>
        ) : null}
      </div>

      <div className="border-t bg-muted/30 px-5 py-3 text-[11px] text-muted-foreground">
        <Activity className="mr-1 inline-block size-3 align-text-bottom" />
        {t("appendOnlyFooter")}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function DiffBlock({ label, value, noValue }: { label: string; value: unknown; noValue: string }) {
  return (
    <div className="overflow-hidden rounded-md border bg-muted/40">
      <div className="border-b bg-background/60 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <pre className="max-h-64 overflow-auto px-2 py-2 font-mono text-[11px] leading-relaxed">
        {value === null || value === undefined
          ? noValue
          : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
