"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations, useFormatter } from "next-intl";
import type { OrderListItem, OrderStatus } from "@/features/orders/types";
import { ORDER_STATUSES, ORDER_STATUS_COLORS } from "@/features/orders/types";
import { formatPrice } from "@/features/orders/lib/order-model";
import { displayAmount } from "@/features/orders/lib/board-view-model";
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
import { LayoutGrid, Plus, Table2 } from "lucide-react";
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

  const counts = useMemo(() => {
    const base: Record<TabValue, number> = {
      all: orders.length,
      pending: 0,
      confirmed: 0,
      ready: 0,
      delivered: 0,
      closed: 0,
      cancelled: 0,
    };
    for (const order of orders) {
      base[order.status] += 1;
    }
    return base;
  }, [orders]);

  const visibleOrders = activeTab === "all" ? orders : orders.filter((o) => o.status === activeTab);

  const formatDate = (date: string) =>
    format.dateTime(new Date(date), { day: "2-digit", month: "short", year: "numeric" });

  const tabLabel = (tab: TabValue) => (tab === "all" ? t("tabs.all") : tStatus(tab));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-3" data-testid="orders-toolbar">
        <ViewToggle label={t("viewToggle.label")}>
          <ViewButton
            active={view === "board"}
            onClick={() => switchView("board")}
            icon={<LayoutGrid className="h-3.5 w-3.5" />}
            label={t("viewToggle.board")}
          />
          <ViewButton
            active={view === "table"}
            onClick={() => switchView("table")}
            icon={<Table2 className="h-3.5 w-3.5" />}
            label={t("viewToggle.table")}
          />
        </ViewToggle>
        <Button onClick={() => router.push(`/${organizationSlug}/orders/new`)}>
          <Plus className="mr-2 h-4 w-4" />
          {t("newOrder")}
        </Button>
      </div>

      {orders.length === 0 ? (
        <HenEmptyState
          title={t("empty.title")}
          subtitle={t("empty.subtitle")}
          className="min-h-[50vh]"
        />
      ) : view === "board" ? (
        <OrdersBoard
          organizationSlug={organizationSlug}
          orders={orders}
          callerRole={callerRole}
          onOrdersChange={setOrders}
        />
      ) : (
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TabValue)}>
          <TabsList>
            {TABS.map((tab) => (
              <TabsTrigger key={tab} value={tab}>
                {tabLabel(tab)}
                <Badge variant="secondary" className="ml-1.5">
                  {counts[tab]}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value={activeTab}>
            <div className="min-h-[calc(100vh-13rem)] rounded-lg border">
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
                  {visibleOrders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        {t("table.empty")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    visibleOrders.map((order) => (
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
                        <TableCell className="text-muted-foreground">{formatDate(order.delivery_date)}</TableCell>
                        <TableCell className="text-right font-medium">
                          {(() => {
                            const amount = displayAmount(order);
                            if (amount.kind === "total") return formatPrice(amount.amount);
                            if (amount.kind === "unweighed") return tCard("unweighed");
                            return "—";
                          })()}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
