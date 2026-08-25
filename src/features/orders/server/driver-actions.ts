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

function err<T = never>(code: DriverErrorCode, message: string, messageKey?: string): ActionResult<T> {
  return { ok: false, code, message, ...(messageKey ? { messageKey } : {}) };
}

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

type GuardResult =
  | { ok: true; orgId: string; userId: string; role: string }
  | { ok: false; code: DriverErrorCode; message: string; messageKey: string };

/**
 * `OrderPermissionError.message` is prose from `guards.ts`, shared with
 * every other order/logistics action (still Phase 3, untranslated). This
 * maps its known messages to `errors.drive.run.*` keys for the one
 * consumer that has been converted (the drive page) without touching the
 * shared error class or its other, unconverted call sites.
 */
function permissionMessageKey(message: string): string {
  if (message === "Not authenticated") return "errors.drive.run.unauthenticated";
  if (message === "Organization not found") return "errors.drive.run.orgNotFound";
  return "errors.drive.run.forbidden";
}

async function guard(organizationSlug: string): Promise<GuardResult> {
  try {
    const ctx = await requireOrgRole(organizationSlug, DRIVER_AND_MANAGER_ROLES);
    return { ok: true, ...ctx };
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      return {
        ok: false,
        code: "forbidden",
        message: error.message,
        messageKey: permissionMessageKey(error.message),
      };
    }
    return {
      ok: false,
      code: "internal",
      message: "Something went wrong. Please try again.",
      messageKey: "errors.drive.run.internal",
    };
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
  if (!ctx.ok) return err(ctx.code, ctx.message, ctx.messageKey);

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("delivery_runs")
    .select("*, truck:trucks(*)")
    .eq("organization_id", ctx.orgId)
    .neq("status", "completed")
    .order("run_date", { ascending: true });

  query = runId ? query.eq("id", runId) : query.eq("driver_id", ctx.userId);

  const { data: runs, error } = await query;
  if (error) return err("internal", "Failed to load the run", "errors.drive.run.loadFailed");

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

/**
 * `mapRpcError` is shared with `order-actions.ts`/`schedule-actions.ts`
 * (still Phase 3, prose-only) and reuses the same raw codes across unrelated
 * RPCs — e.g. "forbidden" and "invalid_status" aren't specific to stop
 * recording. So the `errors.drive.stop.*` messageKey is derived here, from
 * the raw RPC message, rather than added to the shared mapper (which would
 * hand every other unconverted caller a driver-flavoured key).
 */
function stopMessageKey(rawMessage: string): string {
  switch (rawMessage) {
    case "forbidden":
      return "errors.drive.stop.forbidden";
    case "run_not_departed":
      return "errors.drive.stop.notDeparted";
    case "invalid_status":
      return "errors.drive.stop.invalidStatus";
    case "invalid_amount":
      return "errors.drive.stop.invalidAmount";
    case "lines_incomplete":
      return "errors.drive.stop.weightsMissing";
    case "invalid_weight":
      return "errors.drive.stop.invalidWeight";
    default:
      return "errors.drive.stop.internal";
  }
}

async function callStopRpc(
  organizationSlug: string,
  fn: string,
  args: Record<string, unknown>,
): Promise<ActionResult> {
  const ctx = await guard(organizationSlug);
  if (!ctx.ok) return err(ctx.code, ctx.message, ctx.messageKey);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) {
    const mapped = mapRpcError(error.message);
    return err(mapped.code as DriverErrorCode, mapped.message, stopMessageKey(error.message));
  }

  revalidatePath(`/drive/${organizationSlug}`);
  revalidatePath(`/${organizationSlug}/runs`);
  return ok(undefined);
}

/** The truck is at the door. Safe to call twice. */
export async function arriveStop(organizationSlug: string, orderId: string): Promise<ActionResult> {
  return callStopRpc(organizationSlug, "driver_arrive_stop", { p_order: orderId });
}

/**
 * `driver_start_run` errors, mapped the same way `stopMessageKey` maps stop
 * RPC errors — see that function's comment for why the mapping lives here.
 */
function startRunMessageKey(rawMessage: string): string {
  switch (rawMessage) {
    case "forbidden":
      return "errors.drive.run.forbidden";
    case "not_found":
      return "errors.drive.run.notFound";
    case "invalid_transition":
      return "errors.drive.run.alreadyStarted";
    default:
      return "errors.drive.run.internal";
  }
}

/** The driver pulls out of the yard. Non-ready orders return to the pool. */
export async function startRun(organizationSlug: string, runId: string): Promise<ActionResult> {
  const ctx = await guard(organizationSlug);
  if (!ctx.ok) return err(ctx.code, ctx.message, ctx.messageKey);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("driver_start_run", { p_run: runId });
  if (error) {
    const mapped = mapRpcError(error.message);
    return err(mapped.code as DriverErrorCode, mapped.message, startRunMessageKey(error.message));
  }

  revalidatePath(`/drive/${organizationSlug}`);
  revalidatePath(`/${organizationSlug}/runs`);
  return ok(undefined);
}

export type DeliverLineInput = {
  itemId: string;
  finalWeightKg: number;
  finalPieces?: number | null;
};

export type DeliverStopInput = {
  receivedBy?: string | null;
  signaturePath?: string | null;
  photoPath?: string | null;
  cashCollected?: number | null;
  /** One entry per live item; the weights become the billed totals. */
  lines: DeliverLineInput[];
};

/** Goods handed over and weighed. Proof fields optional; weights are not. */
export async function deliverStop(
  organizationSlug: string,
  orderId: string,
  proof: DeliverStopInput,
): Promise<ActionResult> {
  if (proof.cashCollected !== null && proof.cashCollected !== undefined && proof.cashCollected < 0) {
    return err("validation", "Cash collected cannot be negative.", "errors.drive.stop.invalidAmount");
  }
  if (!proof.lines || proof.lines.length === 0) {
    return err("validation", "Weights are required.", "errors.drive.stop.weightsMissing");
  }
  for (const line of proof.lines) {
    if (!Number.isFinite(line.finalWeightKg) || line.finalWeightKg <= 0) {
      return err("validation", "Each item needs a weight above zero.", "errors.drive.stop.invalidWeight");
    }
  }

  return callStopRpc(organizationSlug, "driver_deliver_stop", {
    p_order: orderId,
    p_received_by: proof.receivedBy ?? null,
    p_signature_path: proof.signaturePath ?? null,
    p_photo_path: proof.photoPath ?? null,
    p_cash_collected: proof.cashCollected ?? null,
    p_lines: proof.lines.map((line) => ({
      item_id: line.itemId,
      final_weight_kg: line.finalWeightKg,
      final_pieces: line.finalPieces ?? null,
    })),
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
