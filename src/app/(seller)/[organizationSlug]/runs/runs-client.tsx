"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getRuns, setRunStatus } from "@/features/orders/server/order-actions";
import type { RunWithOrders, RunStatus } from "@/features/orders/types";
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from "@/features/orders/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  planned: "Planned",
  departed: "Departed",
  completed: "Completed",
};

const RUN_STATUS_COLORS: Record<RunStatus, string> = {
  planned: "bg-blue-100 text-blue-800",
  departed: "bg-yellow-100 text-yellow-800",
  completed: "bg-green-100 text-green-800",
};

type RunsClientProps = {
  organizationSlug: string;
  initialDate: string;
  initialRuns: RunWithOrders[];
};

export function RunsClient({ organizationSlug, initialDate, initialRuns }: RunsClientProps) {
  const { toast } = useToast();
  const router = useRouter();
  const [date, setDate] = useState(initialDate);
  const [runs, setRuns] = useState(initialRuns);
  const [loading, setLoading] = useState(false);

  async function loadRuns(nextDate: string) {
    setLoading(true);
    const result = await getRuns(organizationSlug, nextDate);
    setLoading(false);
    if (!result.ok) {
      toast({ title: "Error", description: result.message, variant: "destructive" });
      return;
    }
    setRuns(result.data);
  }

  async function handleDateChange(nextDate: string) {
    setDate(nextDate);
    if (nextDate) await loadRuns(nextDate);
  }

  async function handleStatusChange(runId: string, status: "departed" | "completed") {
    const verb = status === "departed" ? "mark this run as departed" : "mark this run as completed";
    if (!window.confirm(`Are you sure you want to ${verb}?`)) return;
    const result = await setRunStatus(organizationSlug, runId, status);
    if (!result.ok) {
      toast({ title: "Error", description: result.message, variant: "destructive" });
      return;
    }
    toast({ title: `Run marked ${status}` });
    await loadRuns(date);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Delivery runs</h1>
          <p className="text-muted-foreground">Orders grouped by truck for a delivery date</p>
        </div>
        <Input type="date" value={date} onChange={(e) => handleDateChange(e.target.value)} className="w-40" />
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="text-muted-foreground">No runs scheduled for this date.</p>
      ) : (
        <div className="space-y-6">
          {runs.map((run) => (
            <div key={run.id} className="rounded-lg border">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="space-y-1">
                  <div className="font-semibold">
                    {run.truck?.name ?? "Truck"} {run.truck?.code ? `(${run.truck.code})` : ""}
                  </div>
                  <Badge className={RUN_STATUS_COLORS[run.status]}>{RUN_STATUS_LABELS[run.status]}</Badge>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => router.push(`/${organizationSlug}/runs/${run.id}/manifest`)}
                  >
                    Manifest
                  </Button>
                  {run.status === "planned" && (
                    <Button size="sm" onClick={() => handleStatusChange(run.id, "departed")}>
                      Mark departed
                    </Button>
                  )}
                  {run.status !== "completed" && (
                    <Button size="sm" onClick={() => handleStatusChange(run.id, "completed")}>
                      Mark completed
                    </Button>
                  )}
                  {run.status === "completed" && run.orders.some((o) => o.status === "ready") && (
                    <Button size="sm" onClick={() => handleStatusChange(run.id, "completed")}>
                      Deliver remaining
                    </Button>
                  )}
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Zone</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {run.orders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell>{order.customer?.name ?? "-"}</TableCell>
                      <TableCell>{order.zone?.name ?? "-"}</TableCell>
                      <TableCell className="max-w-xs truncate">{order.delivery_address}</TableCell>
                      <TableCell>{order.items.filter((i) => !i.is_cancelled).length} item(s)</TableCell>
                      <TableCell>
                        <Badge className={ORDER_STATUS_COLORS[order.status]}>
                          {ORDER_STATUS_LABELS[order.status]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
