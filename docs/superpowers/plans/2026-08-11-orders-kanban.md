# Orders Kanban Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the seller Orders page into a kanban board (grouped by status, drag triggers workflows) with a Board | Table view switcher, following the shadcnblocks issue-kanban-1 layout.

**Architecture:** A pure drop-rule module (`board-rules.ts`, unit-tested) decides what a drag from status A to status B means: open a workflow dialog, navigate, or bounce with a reason. The board component (`orders-board.tsx`) renders 6 columns with `@dnd-kit/core` and delegates drops to that module. Workflow dialogs are new controlled components that call the *existing* server actions — no new server actions, and `order-detail-client.tsx` is not modified.

**Tech Stack:** Next.js 16 App Router, React 18, Tailwind 4, shadcn/ui (dialog, badge, button, textarea, label, tabs, table), `@dnd-kit/core` (new dependency), vitest (node environment), existing `useToast` hook.

**Spec:** `docs/superpowers/specs/2026-08-11-orders-kanban-design.md`

## Global Constraints

- No new server actions. Only call existing ones from `src/features/orders/server/order-actions.ts`: `getOrderDetail(organizationSlug, orderId)`, `confirmOrder({ organizationSlug, orderId, decisions })`, `cancelOrder(organizationSlug, orderId, reason)`, `reopenOrder(organizationSlug, orderId, reason)`.
- All server actions return `ActionResult<T>`: `{ ok: true; data: T } | { ok: false; code: string; message: string }`. Always branch on `.ok` and toast `.message` on failure.
- Do not modify `order-detail-client.tsx` or any file under `src/features/orders/server/`.
- Vitest only picks up `src/features/**/tests/unit/**/*.test.ts` in a node environment — no DOM/component tests. UI is verified by `npm run typecheck`, `npm run lint`, and a browser check.
- New dependency allowed: `@dnd-kit/core` only. (The spec mentions `@dnd-kit/sortable`, but there is no within-column reordering — column order is derived from data — so YAGNI: core only.)
- Reopen (closed → delivered) is allowed only for roles `owner` and `org_admin` (same gate as `ClosedPanel` in the detail page).
- Status labels/colors come from `ORDER_STATUS_LABELS` / `ORDER_STATUS_COLORS` in `src/features/orders/types.ts`. Prices via `formatPrice` from `src/features/orders/lib/order-model.ts`. Dates via `toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" })`.
- Existing e2e tests exercise the table; the table branch must keep its current DOM (tabs + table) unchanged.

---

### Task 1: Drop-rule module (`board-rules.ts`)

**Files:**
- Create: `src/features/orders/lib/board-rules.ts`
- Test: `src/features/orders/tests/unit/board-rules.test.ts`

**Interfaces:**
- Consumes: `OrderStatus` from `@/features/orders/types`.
- Produces (used by Task 4):
  - `type DropResolution = { kind: "noop" } | { kind: "confirm" } | { kind: "cancel" } | { kind: "settle" } | { kind: "reopen" } | { kind: "blocked"; reason: string }`
  - `function resolveDrop(from: OrderStatus, to: OrderStatus, callerRole: string): DropResolution`

- [ ] **Step 1: Write the failing test**

Create `src/features/orders/tests/unit/board-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveDrop } from "../../lib/board-rules";
import { ORDER_STATUSES } from "../../types";

describe("resolveDrop", () => {
  it("is a noop when dropped on the same column", () => {
    for (const status of ORDER_STATUSES) {
      expect(resolveDrop(status, status, "owner")).toEqual({ kind: "noop" });
    }
  });

  it("pending → confirmed opens the confirm workflow", () => {
    expect(resolveDrop("pending", "confirmed", "sales")).toEqual({ kind: "confirm" });
  });

  it("pending and confirmed → cancelled open the cancel workflow", () => {
    expect(resolveDrop("pending", "cancelled", "sales")).toEqual({ kind: "cancel" });
    expect(resolveDrop("confirmed", "cancelled", "sales")).toEqual({ kind: "cancel" });
  });

  it("delivered → closed routes to settlement", () => {
    expect(resolveDrop("delivered", "closed", "sales")).toEqual({ kind: "settle" });
  });

  it("closed → delivered reopens for owner and org_admin only", () => {
    expect(resolveDrop("closed", "delivered", "owner")).toEqual({ kind: "reopen" });
    expect(resolveDrop("closed", "delivered", "org_admin")).toEqual({ kind: "reopen" });
    const blocked = resolveDrop("closed", "delivered", "sales");
    expect(blocked.kind).toBe("blocked");
  });

  it("blocks moves into ready with the weigh-task reason", () => {
    const result = resolveDrop("confirmed", "ready", "owner");
    expect(result).toEqual({
      kind: "blocked",
      reason: "Ready is set by the warehouse weigh task.",
    });
  });

  it("blocks moves into delivered (except from closed) with the run reason", () => {
    const result = resolveDrop("ready", "delivered", "owner");
    expect(result).toEqual({
      kind: "blocked",
      reason: "Delivered is set when the delivery run completes.",
    });
  });

  it("blocks moves back to pending", () => {
    const result = resolveDrop("confirmed", "pending", "owner");
    expect(result).toEqual({
      kind: "blocked",
      reason: "Orders cannot move back to pending.",
    });
  });

  it("blocks confirming a non-pending order", () => {
    const result = resolveDrop("ready", "confirmed", "owner");
    expect(result).toEqual({
      kind: "blocked",
      reason: "Only pending orders can be confirmed.",
    });
  });

  it("blocks cancelling ready/delivered/closed orders", () => {
    const result = resolveDrop("delivered", "cancelled", "owner");
    expect(result).toEqual({
      kind: "blocked",
      reason: "Only pending or confirmed orders can be cancelled.",
    });
  });

  it("blocks closing a non-delivered order", () => {
    const result = resolveDrop("pending", "closed", "owner");
    expect(result).toEqual({
      kind: "blocked",
      reason: "Only delivered orders can be closed.",
    });
  });

  it("every from/to pair returns a resolution (total function)", () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        const result = resolveDrop(from, to, "owner");
        expect(result.kind).toBeDefined();
        if (result.kind === "blocked") expect(result.reason.length).toBeGreaterThan(0);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/orders/tests/unit/board-rules.test.ts`
Expected: FAIL — cannot resolve `../../lib/board-rules`.

- [ ] **Step 3: Write the implementation**

Create `src/features/orders/lib/board-rules.ts`:

```ts
/**
 * Pure drop rules for the orders kanban board. A drag from one status
 * column to another never writes status directly — it resolves to a
 * workflow (dialog / navigation) or a blocked reason shown as a toast.
 */

import type { OrderStatus } from "../types";

export type DropResolution =
  | { kind: "noop" }
  | { kind: "confirm" }
  | { kind: "cancel" }
  | { kind: "settle" }
  | { kind: "reopen" }
  | { kind: "blocked"; reason: string };

const REOPEN_ROLES = ["owner", "org_admin"];

export function resolveDrop(
  from: OrderStatus,
  to: OrderStatus,
  callerRole: string,
): DropResolution {
  if (from === to) return { kind: "noop" };

  if (from === "pending" && to === "confirmed") return { kind: "confirm" };

  if ((from === "pending" || from === "confirmed") && to === "cancelled") {
    return { kind: "cancel" };
  }

  if (from === "delivered" && to === "closed") return { kind: "settle" };

  if (from === "closed" && to === "delivered") {
    if (REOPEN_ROLES.includes(callerRole)) return { kind: "reopen" };
    return { kind: "blocked", reason: "Only owners or admins can reopen closed orders." };
  }

  if (to === "ready") {
    return { kind: "blocked", reason: "Ready is set by the warehouse weigh task." };
  }
  if (to === "delivered") {
    return { kind: "blocked", reason: "Delivered is set when the delivery run completes." };
  }
  if (to === "pending") {
    return { kind: "blocked", reason: "Orders cannot move back to pending." };
  }
  if (to === "confirmed") {
    return { kind: "blocked", reason: "Only pending orders can be confirmed." };
  }
  if (to === "cancelled") {
    return { kind: "blocked", reason: "Only pending or confirmed orders can be cancelled." };
  }
  // to === "closed"
  return { kind: "blocked", reason: "Only delivered orders can be closed." };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/orders/tests/unit/board-rules.test.ts`
Expected: PASS (all tests green).

Also run the full unit suite to check nothing else broke: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/orders/lib/board-rules.ts src/features/orders/tests/unit/board-rules.test.ts
git commit -m "feat(orders): add kanban drop-rule module"
```

---

### Task 2: Install dnd-kit and build the order card

**Files:**
- Modify: `package.json` (via npm install)
- Create: `src/features/orders/components/order-card.tsx`

**Interfaces:**
- Consumes: `OrderListItem` from `@/features/orders/types`, `formatPrice` from `@/features/orders/lib/order-model`.
- Produces (used by Task 4):
  - `OrderCard({ order, onOpen }: { order: OrderListItem; onOpen: () => void })` — draggable card. Registers itself with dnd-kit via `useDraggable({ id: order.id, data: { status: order.status } })`.
  - `OrderCardContent({ order }: { order: OrderListItem })` — presentational card body, reused by the `DragOverlay` preview.

- [ ] **Step 1: Install the dependency**

Run: `npm install @dnd-kit/core`
Expected: `@dnd-kit/core` appears in `package.json` dependencies, install exits 0.

- [ ] **Step 2: Create the card component**

Create `src/features/orders/components/order-card.tsx`:

```tsx
"use client";

import { useDraggable } from "@dnd-kit/core";
import type { OrderListItem } from "@/features/orders/types";
import { formatPrice } from "@/features/orders/lib/order-model";
import { Badge } from "@/components/ui/badge";

const formatDate = (date: string) =>
  new Date(date).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });

/** Presentational card body — shared by the board card and the DragOverlay preview. */
export function OrderCardContent({ order }: { order: OrderListItem }) {
  return (
    <div className="space-y-2 rounded-lg border bg-card p-3 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-muted-foreground">{order.id.slice(0, 8)}</span>
        <Badge variant="outline" className="text-[10px] capitalize">
          {order.source}
        </Badge>
      </div>
      <div className="text-sm font-medium leading-snug">{order.customer?.name ?? "Unknown"}</div>
      {order.notes && (
        <p className="line-clamp-2 text-xs text-muted-foreground">{order.notes}</p>
      )}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        {order.zone?.name && (
          <Badge variant="secondary" className="text-[10px]">
            {order.zone.name}
          </Badge>
        )}
        <Badge variant="secondary" className="text-[10px]">
          {formatDate(order.delivery_date)}
        </Badge>
        <span className="ml-auto text-xs font-semibold">{formatPrice(order.total_amount)}</span>
      </div>
    </div>
  );
}

export function OrderCard({ order, onOpen }: { order: OrderListItem; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: order.id,
    data: { status: order.status },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      className={
        "cursor-grab touch-none active:cursor-grabbing " + (isDragging ? "opacity-40" : "")
      }
    >
      <OrderCardContent order={order} />
    </div>
  );
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/features/orders/components/order-card.tsx
git commit -m "feat(orders): add dnd-kit and kanban order card"
```

---

### Task 3: Workflow dialogs (confirm / cancel / reopen)

**Files:**
- Create: `src/features/orders/components/board-dialogs.tsx`

**Interfaces:**
- Consumes: `confirmOrder`, `cancelOrder`, `reopenOrder`, `getOrderDetail` from `@/features/orders/server/order-actions`; `OrderWithItems`, `FALLBACK_LABELS` from `@/features/orders/types`; `formatWeight`, `describeFallback` from `@/features/orders/lib/order-model`; `useToast` from `@/hooks/use-toast`.
- Produces (used by Task 4): three controlled dialogs. Each takes `open`, `onOpenChange`, `organizationSlug`, and calls `onDone()` exactly once after a successful server action (the board uses it to move the card and refresh).
  - `ConfirmOrderDialog({ open, onOpenChange, organizationSlug, order, onDone })` — `order: OrderWithItems | null` (board fetches detail before opening; renders nothing while `null`).
  - `CancelOrderBoardDialog({ open, onOpenChange, organizationSlug, orderId, onDone })`
  - `ReopenOrderBoardDialog({ open, onOpenChange, organizationSlug, orderId, onDone })`

- [ ] **Step 1: Create the dialogs**

Create `src/features/orders/components/board-dialogs.tsx`. These are controlled variants of the flows in the order detail page (which stays untouched); all three call existing server actions.

```tsx
"use client";

import { useEffect, useState } from "react";
import { confirmOrder, cancelOrder, reopenOrder } from "@/features/orders/server/order-actions";
import type { OrderWithItems } from "@/features/orders/types";
import { FALLBACK_LABELS } from "@/features/orders/types";
import { formatWeight, describeFallback } from "@/features/orders/lib/order-model";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

type BaseProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationSlug: string;
  onDone: () => void;
};

export function ConfirmOrderDialog({
  open,
  onOpenChange,
  organizationSlug,
  order,
  onDone,
}: BaseProps & { order: OrderWithItems | null }) {
  const { toast } = useToast();
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (order) {
      setAvailability(Object.fromEntries(order.items.map((item) => [item.id, true])));
    }
  }, [order]);

  if (!order) return null;

  async function handleConfirm() {
    if (!order) return;
    setSubmitting(true);
    const result = await confirmOrder({
      organizationSlug,
      orderId: order.id,
      decisions: order.items.map((item) => ({
        itemId: item.id,
        available: availability[item.id] ?? true,
      })),
    });
    setSubmitting(false);
    if (!result.ok) {
      toast({ title: "Error", description: result.message, variant: "destructive" });
      return;
    }
    toast({ title: "Order confirmed" });
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Confirm order {order.id.slice(0, 8).toUpperCase()}</DialogTitle>
          <DialogDescription>Mark each line available or not before confirming.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {order.items.map((item) => {
            const available = availability[item.id] ?? true;
            return (
              <div key={item.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{item.product?.name ?? "Unknown product"}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.mode === "kg" ? formatWeight(item.quantity) : `${item.quantity} pcs`} · size{" "}
                      {item.size_min_kg}–{item.size_max_kg} kg
                    </div>
                    <div className="text-xs text-muted-foreground">
                      If unavailable: {FALLBACK_LABELS[item.fallback]}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant={available ? "default" : "outline"}
                      onClick={() => setAvailability((prev) => ({ ...prev, [item.id]: true }))}
                    >
                      Available
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={!available ? "destructive" : "outline"}
                      onClick={() => setAvailability((prev) => ({ ...prev, [item.id]: false }))}
                    >
                      Not available
                    </Button>
                  </div>
                </div>
                {!available && (
                  <Badge className="mt-2" variant={item.fallback === "cancel" ? "destructive" : "secondary"}>
                    Resulting fallback: {describeFallback(item.fallback)}
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Back
          </Button>
          <Button disabled={submitting} onClick={handleConfirm}>
            {submitting ? "Confirming…" : "Confirm order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CancelOrderBoardDialog({
  open,
  onOpenChange,
  organizationSlug,
  orderId,
  onDone,
}: BaseProps & { orderId: string }) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleCancel() {
    setSubmitting(true);
    const result = await cancelOrder(organizationSlug, orderId, reason);
    setSubmitting(false);
    if (!result.ok) {
      toast({ title: "Error", description: result.message, variant: "destructive" });
      return;
    }
    toast({ title: "Order cancelled" });
    setReason("");
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel order</DialogTitle>
          <DialogDescription>This cannot be undone. Let the team know why.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Reason</Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for cancelling"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Back
          </Button>
          <Button variant="destructive" disabled={submitting} onClick={handleCancel}>
            {submitting ? "Cancelling…" : "Confirm cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReopenOrderBoardDialog({
  open,
  onOpenChange,
  organizationSlug,
  orderId,
  onDone,
}: BaseProps & { orderId: string }) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleReopen() {
    setSubmitting(true);
    const result = await reopenOrder(organizationSlug, orderId, reason);
    setSubmitting(false);
    if (!result.ok) {
      toast({ title: "Error", description: result.message, variant: "destructive" });
      return;
    }
    toast({ title: "Order reopened" });
    setReason("");
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reopen order</DialogTitle>
          <DialogDescription>
            This reverts the order to delivered so settlement can be redone. The action is audit-logged.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Reason</Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you reopening this order?"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={submitting} onClick={handleReopen}>
            {submitting ? "Reopening…" : "Reopen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/features/orders/components/board-dialogs.tsx
git commit -m "feat(orders): controlled workflow dialogs for kanban board"
```

---

### Task 4: Board component (columns + DnD + drop handling)

**Files:**
- Create: `src/features/orders/components/orders-board.tsx`

**Interfaces:**
- Consumes: `resolveDrop` (Task 1), `OrderCard`/`OrderCardContent` (Task 2), the three dialogs (Task 3), `getOrderDetail` server action, `useToast`.
- Produces (used by Task 5): `OrdersBoard({ organizationSlug, orders, callerRole, onOrdersChange }: { organizationSlug: string; orders: OrderListItem[]; callerRole: string; onOrdersChange: (orders: OrderListItem[]) => void })` — parent owns the orders array; the board reports status moves back via `onOrdersChange`.

- [ ] **Step 1: Create the board**

Create `src/features/orders/components/orders-board.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { OrderListItem, OrderStatus, OrderWithItems } from "@/features/orders/types";
import { ORDER_STATUSES, ORDER_STATUS_LABELS } from "@/features/orders/types";
import { resolveDrop } from "@/features/orders/lib/board-rules";
import { getOrderDetail } from "@/features/orders/server/order-actions";
import { OrderCard, OrderCardContent } from "./order-card";
import {
  ConfirmOrderDialog,
  CancelOrderBoardDialog,
  ReopenOrderBoardDialog,
} from "./board-dialogs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STATUS_DOT: Record<OrderStatus, string> = {
  pending: "bg-blue-500",
  confirmed: "bg-yellow-500",
  ready: "bg-green-500",
  delivered: "bg-purple-500",
  closed: "bg-gray-400",
  cancelled: "bg-red-500",
};

type PendingWorkflow =
  | { kind: "confirm"; orderId: string; detail: OrderWithItems }
  | { kind: "cancel"; orderId: string }
  | { kind: "reopen"; orderId: string };

type OrdersBoardProps = {
  organizationSlug: string;
  orders: OrderListItem[];
  callerRole: string;
  onOrdersChange: (orders: OrderListItem[]) => void;
};

export function OrdersBoard({ organizationSlug, orders, callerRole, onOrdersChange }: OrdersBoardProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [activeOrder, setActiveOrder] = useState<OrderListItem | null>(null);
  const [workflow, setWorkflow] = useState<PendingWorkflow | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function moveOrder(orderId: string, to: OrderStatus) {
    onOrdersChange(orders.map((o) => (o.id === orderId ? { ...o, status: to } : o)));
    router.refresh();
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveOrder(orders.find((o) => o.id === event.active.id) ?? null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveOrder(null);
    const { active, over } = event;
    if (!over) return;

    const order = orders.find((o) => o.id === active.id);
    if (!order) return;
    const to = over.id as OrderStatus;
    const resolution = resolveDrop(order.status, to, callerRole);

    switch (resolution.kind) {
      case "noop":
        return;
      case "blocked":
        toast({ title: "Move not allowed", description: resolution.reason, variant: "destructive" });
        return;
      case "settle":
        router.push(`/${organizationSlug}/orders/${order.id}`);
        return;
      case "cancel":
        setWorkflow({ kind: "cancel", orderId: order.id });
        return;
      case "reopen":
        setWorkflow({ kind: "reopen", orderId: order.id });
        return;
      case "confirm": {
        const result = await getOrderDetail(organizationSlug, order.id);
        if (!result.ok) {
          toast({ title: "Error", description: result.message, variant: "destructive" });
          return;
        }
        setWorkflow({ kind: "confirm", orderId: order.id, detail: result.data });
        return;
      }
    }
  }

  return (
    <>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {ORDER_STATUSES.map((status) => (
            <BoardColumn
              key={status}
              status={status}
              orders={orders.filter((o) => o.status === status)}
              onOpenOrder={(id) => router.push(`/${organizationSlug}/orders/${id}`)}
              onNewOrder={() => router.push(`/${organizationSlug}/orders/new`)}
            />
          ))}
        </div>
        <DragOverlay>
          {activeOrder ? (
            <div className="w-72 rotate-2 opacity-90">
              <OrderCardContent order={activeOrder} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <ConfirmOrderDialog
        open={workflow?.kind === "confirm"}
        onOpenChange={(open) => !open && setWorkflow(null)}
        organizationSlug={organizationSlug}
        order={workflow?.kind === "confirm" ? workflow.detail : null}
        onDone={() => workflow && moveOrder(workflow.orderId, "confirmed")}
      />
      <CancelOrderBoardDialog
        open={workflow?.kind === "cancel"}
        onOpenChange={(open) => !open && setWorkflow(null)}
        organizationSlug={organizationSlug}
        orderId={workflow?.kind === "cancel" ? workflow.orderId : ""}
        onDone={() => workflow && moveOrder(workflow.orderId, "cancelled")}
      />
      <ReopenOrderBoardDialog
        open={workflow?.kind === "reopen"}
        onOpenChange={(open) => !open && setWorkflow(null)}
        organizationSlug={organizationSlug}
        orderId={workflow?.kind === "reopen" ? workflow.orderId : ""}
        onDone={() => workflow && moveOrder(workflow.orderId, "delivered")}
      />
    </>
  );
}

function BoardColumn({
  status,
  orders,
  onOpenOrder,
  onNewOrder,
}: {
  status: OrderStatus;
  orders: OrderListItem[];
  onOpenOrder: (id: string) => void;
  onNewOrder: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <section
      ref={setNodeRef}
      aria-label={ORDER_STATUS_LABELS[status]}
      className={
        "flex h-[calc(100vh-16rem)] w-72 shrink-0 flex-col rounded-xl border bg-muted/40 " +
        (isOver ? "ring-2 ring-primary/40" : "")
      }
    >
      <header className="flex items-center gap-2 px-3 py-2.5">
        <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
        <h3 className="text-sm font-semibold">{ORDER_STATUS_LABELS[status]}</h3>
        <Badge variant="secondary" className="text-[10px]">
          {orders.length}
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-6 w-6"
          onClick={onNewOrder}
          aria-label={`Add order to ${ORDER_STATUS_LABELS[status]}`}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {orders.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            No orders
          </div>
        ) : (
          orders.map((order) => (
            <OrderCard key={order.id} order={order} onOpen={() => onOpenOrder(order.id)} />
          ))
        )}
      </div>
      <footer className="px-2 pb-2">
        <Button variant="ghost" className="w-full justify-start text-muted-foreground" size="sm" onClick={onNewOrder}>
          <Plus className="mr-2 h-3.5 w-3.5" />
          New order
        </Button>
      </footer>
    </section>
  );
}
```

Notes for the implementer:
- Dialog-gated moves are NOT optimistic: the card moves only in `onDone`, after the server action succeeded inside the dialog. `router.refresh()` then re-syncs server data in the background. A failed action leaves the card where it was — the "revert" case in the spec is covered by never moving early.
  (Correction from final review: this requires OrdersClient to adopt `initialOrders` into state via an effect — added as a post-review fix.)
- `onClick` and drag coexist because `PointerSensor` has `activationConstraint: { distance: 6 }` — a real drag suppresses the click, a plain click navigates.

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/features/orders/components/orders-board.tsx
git commit -m "feat(orders): kanban board with workflow-gated drag-drop"
```

---

### Task 5: Wire into the orders page (view switcher + callerRole)

**Files:**
- Modify: `src/app/(seller)/[organizationSlug]/orders/page.tsx`
- Modify: `src/app/(seller)/[organizationSlug]/orders/orders-client.tsx`

**Interfaces:**
- Consumes: `OrdersBoard` (Task 4).
- Produces: the finished page. Table branch DOM stays exactly as today (e2e depends on it).

- [ ] **Step 1: Pass callerRole from the server component**

Replace `src/app/(seller)/[organizationSlug]/orders/page.tsx` with:

```tsx
import { notFound, redirect } from "next/navigation";
import { requireOrgRole, OrderPermissionError } from "@/features/orders/server/guards";
import { MANAGER_ROLES } from "@/features/orders/lib/roles";
import { getOrders } from "@/features/orders/server/order-actions";
import { OrdersClient } from "./orders-client";

export default async function OrdersPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;

  let callerRole: string;
  try {
    ({ role: callerRole } = await requireOrgRole(organizationSlug, MANAGER_ROLES));
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      redirect(`/${organizationSlug}`);
    }
    throw error;
  }

  const result = await getOrders(organizationSlug);
  if (!result.ok) notFound();

  return (
    <OrdersClient
      organizationSlug={organizationSlug}
      callerRole={callerRole}
      initialOrders={result.data}
    />
  );
}
```

(This mirrors `orders/[orderId]/page.tsx`. Note the orders list was already manager-gated inside `getOrders`; the explicit guard here only surfaces the role for the board.)

- [ ] **Step 2: Add the view switcher to the client**

In `src/app/(seller)/[organizationSlug]/orders/orders-client.tsx`:

1. Add imports:

```tsx
import { useEffect, useMemo, useState } from "react";
import { OrdersBoard } from "@/features/orders/components/orders-board";
import { LayoutGrid, Table2 } from "lucide-react";
```

(`useEffect` joins the existing react import.)

2. Extend props and state. Replace the props type and the top of the component:

```tsx
type OrdersClientProps = {
  organizationSlug: string;
  callerRole: string;
  initialOrders: OrderListItem[];
};

type ViewMode = "board" | "table";
const VIEW_STORAGE_KEY = "orders-view";
```

```tsx
export function OrdersClient({ organizationSlug, callerRole, initialOrders }: OrdersClientProps) {
  const router = useRouter();
  const [orders, setOrders] = useState(initialOrders);
  const [activeTab, setActiveTab] = useState<TabValue>("pending");
  const [view, setView] = useState<ViewMode>("board");

  useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === "table" || stored === "board") setView(stored);
  }, []);

  function switchView(next: ViewMode) {
    setView(next);
    window.localStorage.setItem(VIEW_STORAGE_KEY, next);
  }
```

(`const [orders] = useState(initialOrders)` becomes `const [orders, setOrders] = useState(initialOrders)`.)

3. Between the header row and the `<Tabs>` block, insert the toolbar, and wrap the existing `<Tabs>` block so it renders only in table view. The return becomes:

```tsx
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
          {/* ...existing TabsList + TabsContent block, byte-for-byte unchanged... */}
        </Tabs>
      )}
    </div>
  );
```

The comment above is a marker for THIS plan only — keep the real existing JSX, do not paste the comment.

- [ ] **Step 3: Verify compile + unit tests**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(seller)/[organizationSlug]/orders/page.tsx" "src/app/(seller)/[organizationSlug]/orders/orders-client.tsx"
git commit -m "feat(orders): board/table view switcher on orders page"
```

---

### Task 6: Browser verification + e2e

**Files:** none created; verification only.

- [ ] **Step 1: Run the dev server and open the orders page**

Use the project's dev server (launch.json / preview tooling, not a raw shell). Log in as the seeded owner, open `/{org}/orders`.

- [ ] **Step 2: Verify board renders**

Check via accessibility tree (read_page), not screenshots:
- 6 column sections labelled Pending / Confirmed / Ready / Delivered / Closed / Cancelled with count badges.
- Seeded closed order appears in the Closed column with customer name, mono id, zone + date badges, RM total.
- View switcher present; clicking Table shows the old tabs+table; choice survives reload (localStorage).

- [ ] **Step 3: Verify drag rules**

- Drag the closed order onto Cancelled: destructive toast "Only pending or confirmed orders can be cancelled." Card stays.
- Drag it onto Delivered (as owner): reopen dialog opens; Cancel closes it, card stays; reopening with a reason moves it to Delivered.
- Drag the now-delivered order onto Closed: navigates to the order detail settlement.
- Card plain click navigates to detail (no drag).

- [ ] **Step 4: Run the e2e suite**

Run: `npm run test:e2e`
Expected: PASS. If a spec drives the orders table, it must still pass — the table is one switcher-click away, and if the spec fails on the default view, fix the spec by clicking the Table button first (allowed change), not by altering the table DOM.

- [ ] **Step 5: Final screenshot as proof + commit any e2e adjustments**

```bash
git add e2e/
git commit -m "test(e2e): switch to table view where specs depend on the orders table"
```

(Skip the commit if no e2e changes were needed.)
