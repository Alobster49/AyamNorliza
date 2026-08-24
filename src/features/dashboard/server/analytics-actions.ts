"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MANAGER_ROLES } from "@/features/orders/lib/roles";
import { OrderPermissionError, requireOrgRole } from "@/features/orders/server/guards";
import type { SalesPayload } from "../analytics/sales-model";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

async function callDashboardRpc<T>(
  organizationSlug: string,
  rpcName: "get_dashboard_sales",
  args: Record<string, unknown>,
): Promise<ActionResult<T>> {
  let orgId: string;
  try {
    ({ orgId } = await requireOrgRole(organizationSlug, MANAGER_ROLES));
  } catch (error) {
    if (error instanceof OrderPermissionError) return { ok: false, message: error.message };
    throw error;
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(rpcName, {
    p_organization_id: orgId,
    ...args,
  });
  // Non-permission RPC failures are not shown verbatim — mirrors the
  // catch-all convention in driver-actions.ts's `guard()`, which never
  // surfaces raw Supabase/Postgres error text to the client.
  if (error) return { ok: false, message: "Something went wrong. Please try again." };
  return { ok: true, data: data as T };
}

export async function getDashboardSales(
  organizationSlug: string,
  from: string,
  to: string,
  bucket: "day" | "week",
): Promise<ActionResult<SalesPayload>> {
  return callDashboardRpc<SalesPayload>(organizationSlug, "get_dashboard_sales", {
    p_from: from,
    p_to: to,
    p_bucket: bucket,
  });
}
