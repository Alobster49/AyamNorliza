"use client";

import { useMemo, useState } from "react";
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
import { Plus } from "lucide-react";

type OrdersClientProps = {
  organizationSlug: string;
  initialOrders: OrderListItem[];
};

const TABS = ["all", ...ORDER_STATUSES] as const;
type TabValue = (typeof TABS)[number];

const TAB_LABELS: Record<TabValue, string> = {
  all: "All",
  ...ORDER_STATUS_LABELS,
};

export function OrdersClient({ organizationSlug, initialOrders }: OrdersClientProps) {
  const router = useRouter();
  const [orders] = useState(initialOrders);
  const [activeTab, setActiveTab] = useState<TabValue>("pending");

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
    </div>
  );
}
