"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { autoAssignOrder } from "@/features/logistics/server/dispatch-actions";
import { requireOrgRole, OrderPermissionError } from "./guards";
import { MANAGER_ROLES, STAFF_ROLES } from "../lib/roles";
import { mapRpcError } from "../lib/rpc-errors";
import {
  PlaceOrderSchema,
  ConfirmOrderSchema,
  CompleteTaskSchema,
  CloseOrderSchema,
  type ActionResult,
  type OrderStatus,
  type RunStatus,
  type OrderListItem,
  type OrderWithItems,
  type TaskWithOrder,
  type RunWithOrders,
  type DeliveryRun,
  type Truck,
  type DeliveryOption,
} from "../types";

type OrderErrorCode = "forbidden" | "validation" | "not_found" | "conflict" | "internal";

function err<T = never>(
  code: OrderErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): ActionResult<T> {
  return { ok: false, code, message, ...(fieldErrors ? { fieldErrors } : {}) };
}

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

async function guardRoles(
  organizationSlug: string,
  roles: readonly string[],
): Promise<
  | { ok: true; orgId: string; userId: string; role: string }
  | { ok: false; code: "forbidden"; message: string }
> {
  try {
    const ctx = await requireOrgRole(organizationSlug, roles);
    return { ok: true, ...ctx };
  } catch (e) {
    if (e instanceof OrderPermissionError) {
      return { ok: false, code: "forbidden", message: e.message };
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Orders queue
// ---------------------------------------------------------------------------

export async function getOrders(
  organizationSlug: string,
  status?: OrderStatus,
): Promise<ActionResult<OrderListItem[]>> {
  const guard = await guardRoles(organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("orders")
    .select("*, customer:customers(name), zone:delivery_zones(name)")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    return err("internal", "Failed to load orders");
  }

  return ok((data ?? []) as OrderListItem[]);
}

export async function getOrderDetail(
  organizationSlug: string,
  orderId: string,
): Promise<ActionResult<OrderWithItems>> {
  const guard = await guardRoles(organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  const { data: order, error } = await supabase
    .from("orders")
    .select(
      `
      *,
      zone:delivery_zones(*),
      slot:delivery_slots(*),
      truck:trucks(*),
      customer:customers(id, name, phone)
    `,
    )
    .eq("id", orderId)
    .eq("organization_id", orgId)
    .single();

  if (error || !order) {
    return err("not_found", "Order not found");
  }

  const { data: items } = await supabase
    .from("order_items")
    .select("*, product:products(id, name, image_url)")
    .eq("order_id", orderId);

  const itemIds = (items ?? []).map((item: { id: string }) => item.id);

  const [{ data: tasks }, { data: weightLog }] = await Promise.all([
    supabase.from("order_tasks").select("*").eq("order_id", orderId),
    // order_weight_log has no order_id column -- scope through the order's
    // items (org-scoped via orgId) instead of a direct order_id filter. The
    // closed-order "Weight log" panel (order-detail-client.tsx) reads this.
    itemIds.length > 0
      ? supabase
          .from("order_weight_log")
          .select("*")
          .eq("organization_id", orgId)
          .in("order_item_id", itemIds)
          .order("recorded_at", { ascending: true })
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  return ok({
    ...(order as OrderWithItems),
    items: (items ?? []) as OrderWithItems["items"],
    tasks: (tasks ?? []) as OrderWithItems["tasks"],
    weight_log: (weightLog ?? []) as OrderWithItems["weight_log"],
  });
}

export async function createManualOrder(
  rawInput: unknown,
): Promise<ActionResult<{ orderId: string }>> {
  const parsed = PlaceOrderSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid order input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  if (!input.customerId) {
    return err("validation", "customerId is required for manual orders");
  }

  const guard = await guardRoles(input.organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  // NOTE: place_order's p_items jsonb is parsed inside the SQL function
  // with camelCase keys (v_item->>'productId', 'sizeMinKg', 'sizeMaxKg') —
  // see supabase/migrations/20260810000002_order_pipeline_functions.sql.
  // Keep these keys camelCase, not snake_case, or every item silently
  // fails as invalid_items. (Mirrors portal-actions.ts's placeOrder.)
  const { data, error } = await supabase.rpc("place_order", {
    p_org: orgId,
    p_zone: input.zoneId,
    p_slot: input.slotId,
    p_date: input.deliveryDate,
    p_address: input.address,
    p_notes: input.notes ?? null,
    p_items: input.items.map((item) => ({
      productId: item.productId,
      mode: item.mode,
      quantity: item.quantity,
      sizeMinKg: item.sizeMinKg,
      sizeMaxKg: item.sizeMaxKg,
      fallback: item.fallback,
    })),
    p_customer: input.customerId,
    p_postcode: input.postcode ?? null,
  });

  if (error) {
    const mapped = mapRpcError(error.message);
    return err(mapped.code as OrderErrorCode, mapped.message);
  }

  const orderId = data as string;

  revalidatePath(`/${input.organizationSlug}/orders`);
  return ok({ orderId });
}

export async function confirmOrder(rawInput: unknown): Promise<ActionResult> {
  const parsed = ConfirmOrderSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid confirmation input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const guard = await guardRoles(input.organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;

  const supabase = await createSupabaseServerClient();
  // NOTE: confirm_order's p_decisions jsonb is read with snake_case keys
  // (v_decision->>'item_id', 'available') per the SQL migration — unlike
  // place_order's p_items, which is camelCase. Verified against
  // supabase/migrations/20260810000002_order_pipeline_functions.sql.
  const { error } = await supabase.rpc("confirm_order", {
    p_order: input.orderId,
    p_decisions: input.decisions.map((d) => ({ item_id: d.itemId, available: d.available })),
  });

  if (error) {
    const mapped = mapRpcError(error.message);
    return err(mapped.code as OrderErrorCode, mapped.message);
  }

  // Fire-and-forget suggestion: a failed auto-assign must never fail the
  // confirm -- the ticket just lands in the dispatch pool instead.
  try {
    await autoAssignOrder(input.organizationSlug, input.orderId);
  } catch {
    // ignore
  }

  revalidatePath(`/${input.organizationSlug}/orders`);
  revalidatePath(`/${input.organizationSlug}/orders/${input.orderId}`);
  return ok(undefined);
}

export async function cancelOrder(
  organizationSlug: string,
  orderId: string,
  reason: string,
): Promise<ActionResult> {
  const guard = await guardRoles(organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("cancel_order", {
    p_order: orderId,
    p_reason: reason,
  });

  if (error) {
    const mapped = mapRpcError(error.message);
    return err(mapped.code as OrderErrorCode, mapped.message);
  }

  revalidatePath(`/${organizationSlug}/orders`);
  revalidatePath(`/${organizationSlug}/orders/${orderId}`);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Warehouse tasks (staff)
// ---------------------------------------------------------------------------

export async function getTodayTasks(
  organizationSlug: string,
): Promise<ActionResult<TaskWithOrder[]>> {
  const guard = await guardRoles(organizationSlug, STAFF_ROLES);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  // Window includes tomorrow: orders are always booked for tomorrow at the
  // earliest (place_order window starts at current_date + 1), so staff load
  // and weigh a delivery the day before it goes out.
  const horizon = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("order_tasks")
    .select(
      `
      *,
      order:orders!inner(
        *,
        zone:delivery_zones(*),
        slot:delivery_slots(*),
        truck:trucks(*),
        customer:customers(id, name, phone),
        items:order_items(*, product:products(id, name, image_url))
      )
    `,
    )
    .eq("organization_id", orgId)
    .eq("status", "pending")
    .eq("order.status", "confirmed")
    .lte("order.delivery_date", horizon);

  if (error) {
    return err("internal", "Failed to load today's tasks");
  }

  return ok((data ?? []) as TaskWithOrder[]);
}

export async function completeTask(rawInput: unknown): Promise<ActionResult> {
  const parsed = CompleteTaskSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid weights input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const guard = await guardRoles(input.organizationSlug, STAFF_ROLES);
  if (!guard.ok) return guard;

  const supabase = await createSupabaseServerClient();
  // NOTE: complete_order_task's p_weights jsonb is read with snake_case
  // keys (v_weight->>'item_id', 'weight_kg', 'pieces') per the SQL
  // migration. Verified against
  // supabase/migrations/20260810000002_order_pipeline_functions.sql.
  const { error } = await supabase.rpc("complete_order_task", {
    p_task: input.taskId,
    p_weights: input.weights.map((w) => ({
      item_id: w.itemId,
      weight_kg: w.weightKg,
      pieces: w.pieces ?? null,
    })),
  });

  if (error) {
    const mapped = mapRpcError(error.message);
    return err(mapped.code as OrderErrorCode, mapped.message);
  }

  revalidatePath(`/${input.organizationSlug}/tasks`);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export async function getRuns(
  organizationSlug: string,
  date: string,
): Promise<ActionResult<RunWithOrders[]>> {
  const guard = await guardRoles(organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  const { data: runs, error } = await supabase
    .from("delivery_runs")
    .select("*, truck:trucks(*)")
    .eq("organization_id", orgId)
    .eq("run_date", date);

  if (error) {
    return err("internal", "Failed to load delivery runs");
  }

  const runIds = (runs ?? []).map((r: DeliveryRun) => r.id);
  const ordersByRun = new Map<string, OrderWithItems[]>();

  if (runIds.length > 0) {
    const { data: orders } = await supabase
      .from("orders")
      .select(
        `
        *,
        zone:delivery_zones(*),
        slot:delivery_slots(*),
        customer:customers(id, name, phone),
        items:order_items(*, product:products(id, name, image_url))
      `,
      )
      .in("run_id", runIds);

    for (const order of (orders ?? []) as OrderWithItems[]) {
      const key = order.run_id as string;
      const existing = ordersByRun.get(key) ?? [];
      existing.push(order);
      ordersByRun.set(key, existing);
    }
  }

  return ok(
    (runs ?? []).map((run: DeliveryRun & { truck?: Truck }) => ({
      ...run,
      orders: ordersByRun.get(run.id) ?? [],
    })) as RunWithOrders[],
  );
}

export async function setRunStatus(
  organizationSlug: string,
  runId: string,
  status: RunStatus,
): Promise<ActionResult> {
  const guard = await guardRoles(organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_run_status", {
    p_run: runId,
    p_status: status,
  });

  if (error) {
    const mapped = mapRpcError(error.message);
    return err(mapped.code as OrderErrorCode, mapped.message);
  }

  revalidatePath(`/${organizationSlug}/runs`);
  return ok(undefined);
}

export async function getRunManifest(
  organizationSlug: string,
  runId: string,
): Promise<ActionResult<RunWithOrders>> {
  const guard = await guardRoles(organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  const { data: run, error } = await supabase
    .from("delivery_runs")
    .select("*, truck:trucks(*)")
    .eq("id", runId)
    .eq("organization_id", orgId)
    .single();

  if (error || !run) {
    return err("not_found", "Delivery run not found");
  }

  const { data: orders } = await supabase
    .from("orders")
    .select(
      `
      *,
      zone:delivery_zones(*),
      slot:delivery_slots(*),
      customer:customers(id, name, phone),
      items:order_items(*, product:products(id, name, image_url))
    `,
    )
    .eq("run_id", runId);

  return ok({
    ...(run as DeliveryRun & { truck?: Truck }),
    orders: (orders ?? []) as OrderWithItems[],
  });
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

export async function getSettlementQueue(
  organizationSlug: string,
): Promise<ActionResult<OrderWithItems[]>> {
  const guard = await guardRoles(organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      `
      *,
      zone:delivery_zones(*),
      slot:delivery_slots(*),
      truck:trucks(*),
      customer:customers(id, name, phone),
      items:order_items(*, product:products(id, name, image_url))
    `,
    )
    .eq("organization_id", orgId)
    .eq("status", "delivered")
    .order("delivery_date", { ascending: true });

  if (error) {
    return err("internal", "Failed to load the settlement queue");
  }

  return ok((data ?? []) as OrderWithItems[]);
}

export async function closeOrder(
  rawInput: unknown,
): Promise<ActionResult<{ total: number }>> {
  const parsed = CloseOrderSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid settlement input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const guard = await guardRoles(input.organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;

  const supabase = await createSupabaseServerClient();
  // NOTE: close_order's p_lines jsonb is read with snake_case keys
  // (v_line->>'item_id', 'final_weight_kg', 'price_per_kg', 'final_pieces')
  // per the SQL migration. Verified against
  // supabase/migrations/20260810000002_order_pipeline_functions.sql.
  const { data, error } = await supabase.rpc("close_order", {
    p_order: input.orderId,
    p_lines: input.lines.map((l) => ({
      item_id: l.itemId,
      final_weight_kg: l.finalWeightKg,
      final_pieces: l.finalPieces ?? null,
      price_per_kg: l.pricePerKg,
    })),
  });

  if (error) {
    const mapped = mapRpcError(error.message);
    return err(mapped.code as OrderErrorCode, mapped.message);
  }

  revalidatePath(`/${input.organizationSlug}/orders`);
  revalidatePath(`/${input.organizationSlug}/orders/${input.orderId}`);
  return ok({ total: Number(data) });
}

export async function reopenOrder(
  organizationSlug: string,
  orderId: string,
  reason: string,
): Promise<ActionResult> {
  const guard = await guardRoles(organizationSlug, ["owner", "org_admin"]);
  if (!guard.ok) return guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("reopen_order", {
    p_order: orderId,
    p_reason: reason,
  });

  if (error) {
    const mapped = mapRpcError(error.message);
    return err(mapped.code as OrderErrorCode, mapped.message);
  }

  revalidatePath(`/${organizationSlug}/orders`);
  revalidatePath(`/${organizationSlug}/orders/${orderId}`);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Manager variant of the buyer-portal delivery-options lookup (used by the
// manual-order screen, which is gated by MANAGER_ROLES rather than
// requireBuyer).
// ---------------------------------------------------------------------------

export async function getDeliveryOptionsForOrg(
  organizationSlug: string,
  zoneId: string,
): Promise<ActionResult<DeliveryOption[]>> {
  const guard = await guardRoles(organizationSlug, MANAGER_ROLES);
  if (!guard.ok) return guard;
  const { orgId } = guard;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_delivery_options", {
    p_org: orgId,
    p_zone: zoneId,
  });

  if (error) {
    return err("internal", "Failed to load delivery options");
  }

  const options = (data ?? []) as Array<{
    option_date: string;
    slot_id: string;
    truck_id: string;
    truck_name: string;
    start_time: string;
    end_time: string;
    remaining: number | null;
  }>;

  return ok(
    options.map((row) => ({
      date: row.option_date,
      slotId: row.slot_id,
      truckId: row.truck_id,
      truckName: row.truck_name,
      startTime: row.start_time,
      endTime: row.end_time,
      remaining: row.remaining,
    })),
  );
}
