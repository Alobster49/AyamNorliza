/**
 * Where a signed-in user lands when they arrive without a specific
 * destination: after login, on "/", or on a bare "/{organizationSlug}".
 *
 * Permission-driven: the member's grant set (see `resolvePermissionsForOrg`)
 * is run through the same canonical group/item order as the sidebar
 * (`getDashboardSidebarGroups`), and they land on the first item they can
 * actually open. Drivers are a special case — anyone whose only real access
 * is the driver deck (`driver_deck:view`, no other nav-visible grant) still
 * lands on `/drive/{slug}`, that being the job they're here to do, even
 * though the (seller) layout now admits any active member (e.g. for My
 * Leave — see the driver deck's leave link and the layout's own comment).
 * Anyone with no visible nav item at all falls back to a page every active
 * member can open.
 *
 * Nothing here may return a bare `/{slug}`: that path only exists to bounce
 * callers back through this module (see app/[organizationSlug]/page.tsx), so
 * returning it would loop.
 */

import "server-only";

import { grantKey } from "@/lib/auth/rbac";
import { resolvePermissionsForOrg } from "@/lib/auth/require-permission";
import { getDashboardSidebarGroups } from "@/features/dashboard/components/dashboard-shell-model";
import { listOrganizationsForCurrentUser } from "./queries";

export const NO_ORGANIZATION_PATH = "/signup";

function pathForGrants(grants: ReadonlySet<string>, slug: string): string {
  const groups = getDashboardSidebarGroups({ organizationSlug: slug, pathname: "", grants });

  // Driver special-case: kept even though the sidebar now carries a
  // "Driving" group (first, so `firstItem` below would already be the deck)
  // -- it also covers a custom role holding driver_deck:view on its own.
  // Everything else (My Leave included) stays in `groups`, so exclude the HR
  // group before checking for that.
  const nonHrGroups = groups.filter(
    (g) => g.sectionKey !== "sections.hr" && g.sectionKey !== "sections.driving",
  );
  if (grants.has(grantKey("driver_deck", "view")) && nonHrGroups.length === 0) {
    return `/drive/${slug}`;
  }

  // HR special-case: `leave_management:view` marks an HR approver, but owner
  // and org_admin also hold it (they hold every grant), and their landing
  // page must stay the dashboard -- gate on the absence of `dashboard:view`,
  // which only those two roles carry. Everyone else who can approve leave
  // belongs in the HR group by default, even when they also hold a
  // Fulfillment-group view grant (e.g. the `driver_roster:view` grant baked
  // into the hr role) that would otherwise sort first in canonical nav order.
  if (
    grants.has(grantKey("leave_management", "view")) &&
    !grants.has(grantKey("dashboard", "view"))
  ) {
    const hrFirstItem = groups.find((g) => g.sectionKey === "sections.hr")?.items[0];
    if (hrFirstItem) return hrFirstItem.href;
  }

  const firstItem = groups[0]?.items[0];
  if (firstItem) return firstItem.href;

  return `/${slug}/settings/organization`;
}

/**
 * Landing path inside one specific organization, or `null` when the caller
 * is not an active member of it. Callers decide the fallback - usually
 * `resolveLandingPath()`, which routes them to an org they do belong to.
 */
export async function resolveLandingPathForSlug(
  _organizationId: string,
  slug: string,
): Promise<string | null> {
  const { context, grants } = await resolvePermissionsForOrg(slug);
  return context ? pathForGrants(grants, slug) : null;
}

export async function resolveLandingPath(): Promise<string> {
  const orgs = await listOrganizationsForCurrentUser();
  const org = orgs[0];
  if (!org) return NO_ORGANIZATION_PATH;

  // No active membership row still lands on settings rather than /signup:
  // the org is RLS-visible, so the dashboard layout is the right place to
  // re-check and bounce them to /login.
  const { context, grants } = await resolvePermissionsForOrg(org.slug);
  return context ? pathForGrants(grants, org.slug) : `/${org.slug}/settings/organization`;
}
