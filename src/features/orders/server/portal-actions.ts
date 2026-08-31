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

function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

/**
 * Same shape as the shared `ActionResult`, except the failure branch carries
 * a `messageKey` (a full path under `errors.buyer.order.*`) instead of prose,
 * so client consumers resolve it with `useTranslations()` + `t(messageKey)`.
 * Scoped to `placeOrder`/`cancelMyOrder` — see the buyer/server/actions.ts
 * `BuyerActionResult` for the pattern this mirrors.
 */
type BuyerOrderActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; code: PortalErrorCode; messageKey: string; fieldErrors?: Record<string, string[]> };

function errKey<T = never>(
  code: PortalErrorCode,
  messageKey: string,
  fieldErrors?: Record<string, string[]>,
): BuyerOrderActionResult<T> {
  return { ok: false, code, messageKey, ...(fieldErrors ? { fieldErrors } : {}) };
}

/**
 * Maps the machine-readable codes raised by the RPCs this file calls
 * (place_order, cancel_order) to friendly message keys under
 * `errors.buyer.order.*`. order-actions.ts owns the canonical mapRpcError
 * covering every RPC's codes; see the CONTRACT CONCERN note at the end of
 * this plan for why this is a separate, smaller copy rather than an import
 * from order-actions.ts.
 */
function mapPortalRpcError(message: string): { code: PortalErrorCode; messageKey: string } {
  switch (message) {
    case "zone_not_found":
      return { code: "not_found", messageKey: "errors.buyer.order.zoneNotFound" };
    case "slot_not_found":
      return { code: "not_found", messageKey: "errors.buyer.order.slotNotFound" };
    case "date_out_of_window":
      return { code: "validation", messageKey: "errors.buyer.order.dateOutOfWindow" };
    case "weekday_mismatch":
      return { code: "validation", messageKey: "errors.buyer.order.weekdayMismatch" };
    case "date_blocked":
      return { code: "conflict", messageKey: "errors.buyer.order.dateBlocked" };
    case "slot_full":
      return { code: "conflict", messageKey: "errors.buyer.order.slotFull" };
    case "invalid_items":
      return { code: "validation", messageKey: "errors.buyer.order.invalidItems" };
    case "invalid_status":
      return { code: "conflict", messageKey: "errors.buyer.order.invalidStatus" };
    case "forbidden":
      return { code: "forbidden", messageKey: "errors.buyer.order.forbidden" };
    default:
      return { code: "internal", messageKey: "errors.buyer.order.internal" };
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
): Promise<BuyerOrderActionResult<{ orderId: string }>> {
  try {
    await requireBuyer();
  } catch (e) {
    if (e instanceof NotABuyerError) {
      return errKey("unauthenticated", "errors.buyer.order.unauthenticated");
    }
    throw e;
  }

  const parsed = PlaceOrderSchema.safeParse(rawInput);
  if (!parsed.success) {
    return errKey("validation", "errors.buyer.order.invalidInput", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  if (input.customerId) {
    return errKey("validation", "errors.buyer.order.customerIdNotAllowed");
  }

  const supabase = await createSupabaseServerClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", input.organizationSlug)
    .single();
  if (!org) {
    return errKey("not_found", "errors.buyer.order.orgNotFound");
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
    p_postcode: input.postcode ?? null,
  });

  if (error) {
    const mapped = mapPortalRpcError(error.message);
    return errKey(mapped.code, mapped.messageKey);
  }

  const orderId = data as string;

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

export async function cancelMyOrder(
  organizationSlug: string,
  orderId: string,
  reason?: string,
): Promise<BuyerOrderActionResult> {
  try {
    await requireBuyer();
  } catch (e) {
    if (e instanceof NotABuyerError) {
      return errKey("unauthenticated", "errors.buyer.order.unauthenticated");
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
    return errKey(mapped.code, mapped.messageKey);
  }

  revalidatePath(`/buyer_portal/${organizationSlug}/orders`);
  return ok(undefined);
}

export async function resolveZoneForPostcode(
  organizationSlug: string,
  postcode: string,
): Promise<ActionResult<{ zoneId: string | null }>> {
  if (!/^[0-9]{5}$/.test(postcode)) {
    return err("validation", "Enter a 5-digit postcode");
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

  const { data, error } = await supabase.rpc("resolve_zone_for_postcode", {
    p_org: org.id,
    p_postcode: postcode,
  });

  if (error) {
    return err("internal", "Failed to check delivery coverage");
  }

  return ok({ zoneId: (data as string | null) ?? null });
}
