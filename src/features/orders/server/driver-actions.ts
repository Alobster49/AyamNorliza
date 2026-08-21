"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireOrgRole, OrderPermissionError } from "./guards";
import { mapRpcError } from "../lib/rpc-errors";
import { DRIVER_AND_MANAGER_ROLES } from "../lib/roles";
import type {
  ActionResult,
  DeliveryFailureReason,
  DeliveryNextAction,
  RunWithOrders,
  DeliveryRun,
  Truck,
  OrderWithItems,
} from "../types";

type DriverErrorCode = "forbidden" | "validation" | "not_found" | "conflict" | "internal";

function err<T = never>(code: DriverErrorCode, message: string): ActionResult<T> {
  return { ok: false, code, message };
}

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

type GuardResult =
  | { ok: true; orgId: string; userId: string; role: string }
  | { ok: false; code: DriverErrorCode; message: string };

async function guard(organizationSlug: string): Promise<GuardResult> {
  try {
    const ctx = await requireOrgRole(organizationSlug, DRIVER_AND_MANAGER_ROLES);
    return { ok: true, ...ctx };
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      return { ok: false, code: "forbidden", message: error.message };
    }
    return { ok: false, code: "internal", message: "Something went wrong. Please try again." };
  }
}

export type DriverRunPayload = {
  organizationId: string;
  run: RunWithOrders | null;
  /** Runs the caller could open instead. Only ever more than one for the office. */
  otherRunIds: string[];
};

/**
 * The run this person is driving today. A driver has at most one (RLS only
 * shows them their own); the office passes an explicit runId to shadow a
 * driver's screen — useful when a driver phones a drop in.
 */
export async function getDriverRun(
  organizationSlug: string,
  runId?: string,
): Promise<ActionResult<DriverRunPayload>> {
  const ctx = await guard(organizationSlug);
  if (!ctx.ok) return err(ctx.code, ctx.message);

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("delivery_runs")
    .select("*, truck:trucks(*)")
    .eq("organization_id", ctx.orgId)
    .neq("status", "completed")
    .order("run_date", { ascending: true });

  query = runId ? query.eq("id", runId) : query.eq("driver_id", ctx.userId);

  const { data: runs, error } = await query;
  if (error) return err("internal", "Failed to load the run");

  const run = (runs ?? [])[0] as (DeliveryRun & { truck?: Truck }) | undefined;
  if (!run) {
    return ok({ organizationId: ctx.orgId, run: null, otherRunIds: [] });
  }

  const { data: orders } = await supabase
    .from("orders")
    .select(
      `
      *,
      zone:delivery_zones(*),
      slot:delivery_slots(*),
      customer:customers(id, name, phone),
      items:order_items(*, product:products(id, name, image_url)),
      attempts:delivery_attempts(*),
      stop_events:run_stop_events(*)
    `,
    )
    .eq("run_id", run.id);

  return ok({
    organizationId: ctx.orgId,
    run: { ...run, orders: (orders ?? []) as OrderWithItems[] } as RunWithOrders,
    otherRunIds: (runs ?? []).slice(1).map((r: DeliveryRun) => r.id),
  });
}

async function callStopRpc(
  organizationSlug: string,
  fn: string,
  args: Record<string, unknown>,
): Promise<ActionResult> {
  const ctx = await guard(organizationSlug);
  if (!ctx.ok) return err(ctx.code, ctx.message);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) {
    const mapped = mapRpcError(error.message);
    return err(mapped.code as DriverErrorCode, mapped.message);
  }

  revalidatePath(`/drive/${organizationSlug}`);
  revalidatePath(`/${organizationSlug}/runs`);
  return ok(undefined);
}

/** The truck is at the door. Safe to call twice. */
export async function arriveStop(organizationSlug: string, orderId: string): Promise<ActionResult> {
  return callStopRpc(organizationSlug, "driver_arrive_stop", { p_order: orderId });
}

export type DeliverStopInput = {
  receivedBy?: string | null;
  signaturePath?: string | null;
  photoPath?: string | null;
  cashCollected?: number | null;
};

/** Goods handed over. Every proof field is optional by design. */
export async function deliverStop(
  organizationSlug: string,
  orderId: string,
  proof: DeliverStopInput = {},
): Promise<ActionResult> {
  if (proof.cashCollected !== null && proof.cashCollected !== undefined && proof.cashCollected < 0) {
    return err("validation", "Cash collected cannot be negative.");
  }

  return callStopRpc(organizationSlug, "driver_deliver_stop", {
    p_order: orderId,
    p_received_by: proof.receivedBy ?? null,
    p_signature_path: proof.signaturePath ?? null,
    p_photo_path: proof.photoPath ?? null,
    p_cash_collected: proof.cashCollected ?? null,
  });
}

/** Nobody there, goods refused, no cash, wrong address. The order stays owed. */
export async function failStop(
  organizationSlug: string,
  orderId: string,
  reason: DeliveryFailureReason,
  nextAction: DeliveryNextAction | null = null,
  note: string | null = null,
): Promise<ActionResult> {
  return callStopRpc(organizationSlug, "driver_fail_stop", {
    p_order: orderId,
    p_reason: reason,
    p_next_action: nextAction,
    p_note: note,
  });
}
