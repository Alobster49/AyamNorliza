"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations, useFormatter } from "next-intl";
import type { OrderListItem, OrderStatus } from "@/features/orders/types";
import { ORDER_STATUSES, ORDER_STATUS_COLORS, ORDER_STATUS_DOT } from "@/features/orders/types";
import { formatPrice } from "@/features/orders/lib/order-model";
import { applyLens, displayAmount, isAtRisk, matchesSearch, type DateLens } from "@/features/orders/lib/board-view-model";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { LayoutGrid, Plus, Search, Table2 } from "lucide-react";
import { HenEmptyState } from "@/components/shared/hen-empty-state";
import { ViewToggle, ViewButton } from "@/components/shared/view-toggle";
import { OrdersBoard } from "@/features/orders/components/orders-board";

type OrdersClientProps = {
  organizationSlug: string;
  callerRole: string;
  initialOrders: OrderListItem[];
  today: string;
};

type ViewMode = "board" | "table";
const VIEW_STORAGE_KEY = "orders-view";

const TABS = ["all", ...ORDER_STATUSES] as const;
type TabValue = (typeof TABS)[number];

export function OrdersClient({ organizationSlug, callerRole, initialOrders, today }: OrdersClientProps) {
  const router = useRouter();
  const t = useTranslations("orders.client");
  const tStatus = useTranslations("status.order");
  const tCard = useTranslations("orders.card");
  const format = useFormatter();
  const [orders, setOrders] = useState(initialOrders);
  const [activeTab, setActiveTab] = useState<TabValue>("all");
  const [view, setView] = useState<ViewMode>("board");
  const [lens, setLens] = useState<DateLens>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    // router.refresh() after a workflow returns fresh server data — adopt it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrders(initialOrders);
  }, [initialOrders]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
      if (stored === "table" || stored === "board") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setView(stored);
        return;
      }
    } catch {
      // storage unavailable (private browsing) — fall through to viewport default
    }
    // First visit on a phone: six 288px columns are unusable — start on the table.
    if (window.matchMedia("(max-width: 639px)").matches) {
      setView("table");
    }
  }, []);

  function switchView(next: ViewMode) {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // storage unavailable — view still switches for this session
    }
  }

  const visibleBase = useMemo(
    () => applyLens(orders, lens, today).filter((o) => matchesSearch(o, search)),
    [orders, lens, today, search],
  );

  const counts = useMemo(() => {
    const base: Record<TabValue, number> = {
      all: visibleBase.length,
      pending: 0,
      confirmed: 0,
      ready: 0,
      delivered: 0,
      closed: 0,
      cancelled: 0,
    };
    for (const order of visibleBase) {
      base[order.status] += 1;
    }
    return base;
  }, [visibleBase]);

  const visibleOrders =
    activeTab === "all" ? visibleBase : visibleBase.filter((o) => o.status === activeTab);

  const formatDate = (date: string) =>
    format.dateTime(new Date(date), { day: "2-digit", month: "short", year: "numeric" });

  // The phone row has one line for all the metadata — the year never varies enough to earn its width.
  const formatDateShort = (date: string) =>
    format.dateTime(new Date(date), { day: "2-digit", month: "short" });

  const tabLabel = (tab: TabValue) => (tab === "all" ? t("tabs.all") : tStatus(tab));

  return (
    <div className="flex h-[calc(100svh-4rem-1.5rem)] flex-col gap-3 md:h-[calc(100svh-7rem)] md:gap-6">
      <div
        className="flex shrink-0 flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:justify-end md:gap-3"
        data-testid="orders-toolbar"
      >
        {/* Phone: row 1 = search + view toggle + add; row 2 = the date lens, full width.
            `md:contents` dissolves the row wrapper so `md:order-*` can rebuild the
            desktop layout (search and lens left, view toggle and action right). */}
        <div className="flex items-center gap-2 md:contents">
          <div className="relative min-w-0 flex-1 md:order-1 md:w-full md:max-w-xs md:flex-none">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 rounded-full pl-9 md:h-9 md:rounded-md"
            />
          </div>
          <ViewToggle label={t("viewToggle.label")} className="shrink-0 md:order-3">
            <ViewButton
              active={view === "board"}
              onClick={() => switchView("board")}
              icon={<LayoutGrid className="h-4 w-4 md:h-3.5 md:w-3.5" />}
              label={t("viewToggle.board")}
              compactLabel
            />
            <ViewButton
              active={view === "table"}
              onClick={() => switchView("table")}
              icon={<Table2 className="h-4 w-4 md:h-3.5 md:w-3.5" />}
              label={t("viewToggle.table")}
              compactLabel
            />
          </ViewToggle>
          <Button
            onClick={() => router.push(`/${organizationSlug}/orders/new`)}
            aria-label={t("newOrder")}
            className="h-10 w-10 shrink-0 rounded-full p-0 md:order-4 md:h-9 md:w-auto md:rounded-md md:px-4"
          >
            <Plus className="h-4 w-4 md:mr-2" />
            <span className="hidden md:inline">{t("newOrder")}</span>
          </Button>
        </div>
        <ViewToggle label={t("lens.label")} className="w-full md:order-2 md:mr-auto md:w-fit">
          {(["today", "tomorrow", "all"] as const).map((value) => (
            <ViewButton
              key={value}
              active={lens === value}
              onClick={() => setLens(value)}
              icon={null}
              label={t(`lens.${value}`)}
              className="min-w-0 flex-1 whitespace-nowrap md:flex-none"
            />
          ))}
        </ViewToggle>
      </div>

      <div className="min-h-0 flex-1">
        {orders.length === 0 ? (
          <HenEmptyState
            title={t("empty.title")}
            subtitle={t("empty.subtitle")}
            className="h-full"
          />
        ) : view === "board" ? (
          visibleBase.length === 0 ? (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
              {t("table.empty")}
            </div>
          ) : (
            <OrdersBoard
              organizationSlug={organizationSlug}
              orders={visibleBase}
              callerRole={callerRole}
              onOrderStatusChange={(orderId, status) =>
                setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status } : o)))
              }
              today={today}
            />
          )
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as TabValue)}
            className="flex h-full flex-col sm:block sm:h-auto"
          >
            {/* The mask fades the last tab out instead of clipping it — the only
                cue on a phone that the strip keeps going. */}
            <div className="-mx-1 shrink-0 overflow-x-auto px-1 pb-1 [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] sm:[mask-image:none]">
              <TabsList className="snap-x snap-mandatory">
                {TABS.map((tab) => (
                  <TabsTrigger key={tab} value={tab} className="snap-start">
                    {tabLabel(tab)}
                    {counts[tab] > 0 && (
                      <Badge variant="secondary" className="ml-1.5">
                        {counts[tab]}
                      </Badge>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            <TabsContent
              value={activeTab}
              className="min-h-0 flex-1 overflow-y-auto sm:overflow-visible"
            >
              {visibleOrders.length === 0 ? (
                <div className="flex h-full min-h-[40vh] items-center justify-center rounded-xl border py-8 text-center text-sm text-muted-foreground sm:min-h-[calc(100vh-13rem)]">
                  {t("table.empty")}
                </div>
              ) : (
                <>
                  {/* Mobile: one dense row per order — a 6-column table has no
                      room on a phone, and stacked cards fit only five. */}
                  <div className="divide-y overflow-hidden rounded-xl border bg-card sm:hidden">
                    {visibleOrders.map((order) => {
                      const risk = isAtRisk(order, today);
                      const amount = displayAmount(order);
                      return (
                        <div
                          key={order.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => router.push(`/${organizationSlug}/orders/${order.id}`)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") router.push(`/${organizationSlug}/orders/${order.id}`);
                          }}
                          className="flex min-h-14 cursor-pointer items-center gap-2.5 px-3 py-2.5 transition-colors active:bg-accent"
                        >
                          <span
                            aria-hidden="true"
                            className={`h-2 w-2 shrink-0 rounded-full ${ORDER_STATUS_DOT[order.status]}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium leading-tight">
                              {order.customer?.name ?? tCard("unknownCustomer")}
                            </div>
                            <div className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground">
                              <span className="font-mono">{order.id.slice(0, 8)}</span>
                              {order.zone?.name && <> · {order.zone.name}</>}
                              {" · "}
                              {formatDateShort(order.delivery_date)}
                              {risk && (
                                <span className="font-medium text-destructive">
                                  {" · "}
                                  {t(`atRisk.${risk}`)}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            {amount.kind === "total" ? (
                              <div className="text-sm font-semibold tabular-nums">
                                {formatPrice(amount.amount)}
                              </div>
                            ) : amount.kind === "unweighed" ? (
                              <div className="text-[10px] leading-tight text-muted-foreground">
                                {tCard("unweighed")}
                              </div>
                            ) : null}
                            {/* Inside a status tab every row shares the status — the dot is enough. */}
                            {activeTab === "all" && (
                              <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
                                {tStatus(order.status)}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Tablet/desktop: full table */}
                  <div className="hidden min-h-[calc(100vh-13rem)] rounded-lg border sm:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("table.headers.order")}</TableHead>
                          <TableHead>{t("table.headers.customer")}</TableHead>
                          <TableHead>{t("table.headers.zone")}</TableHead>
                          <TableHead>{t("table.headers.status")}</TableHead>
                          <TableHead>{t("table.headers.deliveryDate")}</TableHead>
                          <TableHead className="text-right">{t("table.headers.total")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleOrders.map((order) => {
                          const risk = isAtRisk(order, today);
                          return (
                            <TableRow
                              key={order.id}
                              className="cursor-pointer"
                              onClick={() => router.push(`/${organizationSlug}/orders/${order.id}`)}
                            >
                              <TableCell className="font-mono text-sm">{order.id.slice(0, 8)}</TableCell>
                              <TableCell>{order.customer?.name ?? tCard("unknownCustomer")}</TableCell>
                              <TableCell>{order.zone?.name ?? "-"}</TableCell>
                              <TableCell>
                                <Badge className={ORDER_STATUS_COLORS[order.status]}>
                                  {tStatus(order.status)}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {formatDate(order.delivery_date)}
                                {risk && (
                                  <Badge variant="destructive" className="ml-2 text-[10px]">
                                    {t(`atRisk.${risk}`)}
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right font-medium tabular-nums">
                                {(() => {
                                  const amount = displayAmount(order);
                                  if (amount.kind === "total") return formatPrice(amount.amount);
                                  if (amount.kind === "unweighed") return tCard("unweighed");
                                  return "—";
                                })()}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}
