/**
 * Where a signed-in user lands when they arrive without a specific
 * destination: after login, on "/", or on a bare "/{organizationSlug}".
 *
 * Owner and Admin land on the dashboard, so the app opens on the KPI
 * overview rather than the catalog. Sellers and supervisors land on
 * Products (the sales dashboard is admin-only now). Workers (stored role
 * "inventory") land on the warehouse queue. Drivers still land on the driver deck by
 * default — that is the job they're here to do — even though the (seller)
 * layout now admits any active member (so a driver *can* open the seller
 * shell, e.g. for My Leave; see the driver deck's leave link and the layout's
 * own comment). HR lands on the leave approval queue, since that is the only
 * screen their role exists to open. Anyone else falls back to a page every
 * active member can open.
 *
 * Nothing here may return a bare `/{slug}`: that path only exists to bounce
 * callers back through this module (see app/[organizationSlug]/page.tsx), so
 * returning it would loop.
 */

import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ADMIN_ROLES } from "@/features/orders/lib/roles";
import { listOrganizationsForCurrentUser } from "./queries";

export const NO_ORGANIZATION_PATH = "/signup";

function pathForRole(role: string, slug: string): string {
  if ((ADMIN_ROLES as readonly string[]).includes(role)) {
    return `/${slug}/dashboard`;
  }
  if (role === "seller" || role === "supervisor") {
    return `/${slug}/products`;
  }
  if (role === "inventory") {
    return `/${slug}/tasks`;
  }
  if (role === "driver") {
    return `/drive/${slug}`;
  }
  if (role === "hr") {
    return `/${slug}/leave/manage`;
  }
  return `/${slug}/settings/organization`;
}

async function activeRoleFor(organizationId: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: member } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  return member?.role ?? null;
}

/**
 * Landing path inside one specific organization, or `null` when the caller
 * is not an active member of it. Callers decide the fallback - usually
 * `resolveLandingPath()`, which routes them to an org they do belong to.
 */
export async function resolveLandingPathForSlug(
  organizationId: string,
  slug: string,
): Promise<string | null> {
  const role = await activeRoleFor(organizationId);
  return role ? pathForRole(role, slug) : null;
}

export async function resolveLandingPath(): Promise<string> {
  const orgs = await listOrganizationsForCurrentUser();
  const org = orgs[0];
  if (!org) return NO_ORGANIZATION_PATH;

  // No active membership row still lands on settings rather than /signup:
  // the org is RLS-visible, so the dashboard layout is the right place to
  // re-check and bounce them to /login.
  const role = await activeRoleFor(org.id);
  return role ? pathForRole(role, org.slug) : `/${org.slug}/settings/organization`;
}
