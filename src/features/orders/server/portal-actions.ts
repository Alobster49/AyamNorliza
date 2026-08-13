"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireBuyer, NotABuyerError } from "@/lib/auth/buyer-auth";
import {
  PlaceOrderSchema,
  type ActionResult,
  type DeliveryZone,
  type DeliveryOption,
  type OrderListItem,
  type OrderWithItems,
} from "../types";

type PortalErrorCode = "validation" | "unauthenticated" | "not_found" | "conflict" | "internal" | "forbidden";

function err<T = never>(
  code: PortalErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): ActionResult<T> {
  return { ok: false, code, message, ...(fieldErrors ? { fieldErrors } : {}) };
}

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

/**
 * Maps the machine-readable codes raised by the RPCs this file calls
 * (place_order, cancel_order) to friendly messages. order-actions.ts owns
 * the canonical mapRpcError covering every RPC's codes; see the CONTRACT
 * CONCERN note at the end of this plan for why this is a separate, smaller
 * copy rather than an import from order-actions.ts.
 */
function mapPortalRpcError(message: string): { code: PortalErrorCode; message: string } {
  switch (message) {
    case "zone_not_found":
      return { code: "not_found", message: "That delivery zone was not found." };
    case "slot_not_found":
      return { code: "not_found", message: "That delivery slot is no longer available." };
    case "date_out_of_window":
      return { code: "validation", message: "Pick a delivery date within the next 14 days." };
    case "weekday_mismatch":
      return { code: "validation", message: "That date does not match the slot's day of the week." };
    case "date_blocked":
      return { code: "conflict", message: "Deliveries are blocked on that date. Pick another." };
    case "slot_full":
      return { code: "conflict", message: "That delivery slot just filled up — pick another." };
    case "invalid_items":
      return { code: "validation", message: "One or more items in your order are invalid." };
    case "invalid_status":
      return { code: "conflict", message: "This order can no longer be cancelled." };
    case "forbidden":
      return { code: "forbidden", message: "You cannot cancel this order." };
    default:
      return { code: "internal", message: "Something went wrong. Please try again." };
  }
}

export async function getActiveZones(
  organizationSlug: string,
): Promise<ActionResult<DeliveryZone[]>> {
  const supabase = await createSupabaseServerClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", organizationSlug)
    .single();
  if (!org) {
    return err("not_found", "Organization not found");
  }

  const { data, error } = await supabase
    .from("delivery_zones")
    .select("*")
    .eq("organization_id", org.id)
    .eq("is_active", true)
    .order("display_order", { ascending: true });

  if (error) {
    return err("internal", "Failed to load delivery zones");
  }

  return ok((data ?? []) as DeliveryZone[]);
}

export async function getDeliveryOptions(
  organizationSlug: string,
  zoneId: string,
): Promise<ActionResult<DeliveryOption[]>> {
  try {
    await requireBuyer();
  } catch (e) {
    if (e instanceof NotABuyerError) {
      return err("unauthenticated", e.message);
    }
    throw e;
  }

  const supabase = await createSupabaseServerClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", organizationSlug)
    .single();
  if (!org) {
    return err("not_found", "Organization not found");
  }

  const { data, error } = await supabase.rpc("get_delivery_options", {
    p_org: org.id,
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

export async function placeOrder(
  rawInput: unknown,
): Promise<ActionResult<{ orderId: string }>> {
  try {
    await requireBuyer();
  } catch (e) {
    if (e instanceof NotABuyerError) {
      return err("unauthenticated", e.message);
    }
    throw e;
  }

  const parsed = PlaceOrderSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid order input", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  if (input.customerId) {
    return err("validation", "customerId is not allowed for portal orders");
  }

  const supabase = await createSupabaseServerClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", input.organizationSlug)
    .single();
  if (!org) {
    return err("not_found", "Organization not found");
  }

  // NOTE: place_order's p_items jsonb is parsed inside the SQL function
  // with camelCase keys (v_item->>'productId', 'sizeMinKg', 'sizeMaxKg') —
  // see supabase/migrations/20260810000002_order_pipeline_functions.sql
  // and supabase/tests/rls/08_order_rpcs.sql. Keep these keys camelCase,
  // not snake_case, or every item silently fails as invalid_items.
  const { data, error } = await supabase.rpc("place_order", {
    p_org: org.id,
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
  });

  if (error) {
    const mapped = mapPortalRpcError(error.message);
    return err(mapped.code, mapped.message);
  }

  const orderId = data as string;

  // place_order's RPC signature has no postcode parameter -- write it back
  // onto the freshly created row so dispatch auto-assignment (which reads
  // orders.postcode) can match it to a zone. Orders placed without a
  // postcode are still valid; they just land in the dispatch board's
  // Unassigned pool for manual drag.
  if (input.postcode) {
    await supabase.from("orders").update({ postcode: input.postcode }).eq("id", orderId);
  }

  revalidatePath(`/buyer_portal/${input.organizationSlug}/orders`);
  return ok({ orderId });
}

export async function getMyOrders(): Promise<ActionResult<OrderListItem[]>> {
  try {
    await requireBuyer();
  } catch (e) {
    if (e instanceof NotABuyerError) {
      return err("unauthenticated", e.message);
    }
    throw e;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*, customer:customers(name), zone:delivery_zones(name)")
    .order("created_at", { ascending: false });

  if (error) {
    return err("internal", "Failed to load your orders");
  }

  return ok((data ?? []) as OrderListItem[]);
}

export async function getMyOrder(orderId: string): Promise<ActionResult<OrderWithItems>> {
  try {
    await requireBuyer();
  } catch (e) {
    if (e instanceof NotABuyerError) {
      return err("unauthenticated", e.message);
    }
    throw e;
  }

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
    .single();

  if (error || !order) {
    return err("not_found", "Order not found");
  }

  const { data: items } = await supabase
    .from("order_items")
    .select("*, product:products(id, name, image_url)")
    .eq("order_id", orderId);

  return ok({
    ...(order as OrderWithItems),
    items: (items ?? []) as OrderWithItems["items"],
  });
}

export async function cancelMyOrder(orderId: string, reason?: string): Promise<ActionResult> {
  try {
    await requireBuyer();
  } catch (e) {
    if (e instanceof NotABuyerError) {
      return err("unauthenticated", e.message);
    }
    throw e;
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("cancel_order", {
    p_order: orderId,
    p_reason: reason ?? null,
  });

  if (error) {
    const mapped = mapPortalRpcError(error.message);
    return err(mapped.code, mapped.message);
  }

  return ok(undefined);
}
