/**
 * Org-role guard for the order-pipeline Server Actions.
 *
 * Every action in schedule-actions.ts and order-actions.ts calls
 * `requireOrgRole` before touching Supabase. Server Components that need
 * to redirect instead of receiving a typed error use
 * `requireRoleOrRedirect` (mirrors `requireBuyerOrRedirect` in
 * @/lib/auth/buyer-auth).
 */

import "server-only";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export class OrderPermissionError extends Error {
  readonly code = "forbidden";
  constructor(message = "You do not have access to this feature") {
    super(message);
    this.name = "OrderPermissionError";
  }
}

export type OrgRoleContext = { orgId: string; userId: string; role: string };

export async function requireOrgRole(
  organizationSlug: string,
  roles: readonly string[],
): Promise<OrgRoleContext> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new OrderPermissionError("Not authenticated");
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", organizationSlug)
    .single();
  if (!org) {
    throw new OrderPermissionError("Organization not found");
  }

  const { data: member } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", org.id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (!member || !roles.includes(member.role)) {
    throw new OrderPermissionError();
  }

  return { orgId: org.id, userId: user.id, role: member.role };
}

/**
 * For Server Components that cannot redirect from inside try/catch.
 */
export async function requireRoleOrRedirect(
  organizationSlug: string,
  roles: readonly string[],
): Promise<OrgRoleContext> {
  try {
    return await requireOrgRole(organizationSlug, roles);
  } catch (e) {
    if (e instanceof OrderPermissionError) {
      redirect(`/${organizationSlug}`);
    }
    throw e;
  }
}
