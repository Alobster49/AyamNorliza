/**
 * Bare `/{organizationSlug}` - the organization root.
 *
 * Nothing renders here; it exists because several guards bounce callers to
 * this path and it used to 404. The two producers are:
 *
 *   1. `requireUserOrRedirect(`/${organizationSlug}`)` in the (seller) and
 *      (dashboard) layouts, which stores it as `?next=` for the login form.
 *      A user whose session expired on any org page therefore signed back in
 *      and landed on a 404.
 *   2. Role guards that bounce a caller out of a page they may not open
 *      (seller layout, orders/tasks pages, orders/server/guards.ts).
 *
 * Both want the same thing: "send this member wherever they belong in this
 * org", which is exactly `resolveLandingPathForSlug`. This page lives outside
 * the (seller)/(dashboard) route groups on purpose - inside either one it
 * would inherit that group's role check, and case 2 would loop.
 */

import { notFound, redirect } from "next/navigation";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import {
  resolveLandingPath,
  resolveLandingPathForSlug,
} from "@/features/identity-access/server/landing";

export default async function OrganizationRootPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  await requireUserOrRedirect(`/${organizationSlug}`);

  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();

  // Not an active member of this org (or it is not theirs at all): fall back
  // to an org they do belong to, or /signup when they belong to none.
  const path = await resolveLandingPathForSlug(org.id, organizationSlug);
  redirect(path ?? (await resolveLandingPath()));
}
