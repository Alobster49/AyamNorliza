"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { OrderListItem, OrderStatus } from "@/features/orders/types";
import { ORDER_STATUSES, ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from "@/features/orders/types";
import { formatPrice } from "@/features/orders/lib/order-model";
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
import { OrdersBoard } from "@/features/orders/components/orders-board";

type OrdersClientProps = {
  organizationSlug: string;
  callerRole: string;
  initialOrders: OrderListItem[];
};

type ViewMode = "board" | "table";
const VIEW_STORAGE_KEY = "orders-view";

const TABS = ["all", ...ORDER_STATUSES] as const;
type TabValue = (typeof TABS)[number];

const TAB_LABELS: Record<TabValue, string> = {
  all: "All",
  ...ORDER_STATUS_LABELS,
};

export function OrdersClient({ organizationSlug, callerRole, initialOrders }: OrdersClientProps) {
  const router = useRouter();
  const [orders, setOrders] = useState(initialOrders);
  const [activeTab, setActiveTab] = useState<TabValue>("pending");
  const [view, setView] = useState<ViewMode>("board");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
      if (stored === "table" || stored === "board") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setView(stored);
      }
    } catch {
      // storage unavailable (private browsing) — keep default view
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
    new Date(date).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Orders</h1>
          <p className="text-muted-foreground">Manage the order pipeline</p>
        </div>
        <Button onClick={() => router.push(`/${organizationSlug}/orders/new`)}>
          <Plus className="mr-2 h-4 w-4" />
          New Order
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="inline-flex rounded-lg border p-0.5">
          <Button
            variant={view === "board" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 gap-1.5 px-2.5"
            onClick={() => switchView("board")}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Board
          </Button>
          <Button
            variant={view === "table" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 gap-1.5 px-2.5"
            onClick={() => switchView("table")}
          >
            <Table2 className="h-3.5 w-3.5" />
            Table
          </Button>
        </div>
        <span className="text-sm text-muted-foreground">
          {orders.length} {orders.length === 1 ? "order" : "orders"}
        </span>
        {view === "board" && <span className="text-sm text-muted-foreground">· Grouped by status</span>}
      </div>

      {view === "board" ? (
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
                {TAB_LABELS[tab]}
                <Badge variant="secondary" className="ml-1.5">
                  {counts[tab]}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value={activeTab}>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Zone</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Delivery date</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleOrders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        No orders in this view
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
                        <TableCell>{order.customer?.name ?? "Unknown"}</TableCell>
                        <TableCell>{order.zone?.name ?? "-"}</TableCell>
                        <TableCell>
                          <Badge className={ORDER_STATUS_COLORS[order.status]}>
                            {ORDER_STATUS_LABELS[order.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{formatDate(order.delivery_date)}</TableCell>
                        <TableCell className="text-right font-medium">{formatPrice(order.total_amount)}</TableCell>
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
