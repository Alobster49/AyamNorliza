/**
 * Dynamic-RBAC guard: per-request permission checks backed by
 * `organization_roles` / `role_permissions` (see
 * supabase/migrations/20260901000001_dynamic_rbac_schema.sql), replacing
 * the hardcoded role-list checks in `requireOrgRole` for callers that need
 * granular (resource, action) grants instead of a role allow-list.
 *
 * Reuses `OrderPermissionError` from the order-pipeline guards so existing
 * catch sites (`e instanceof OrderPermissionError`) keep working unchanged.
 */

import "server-only";

import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OrderPermissionError } from "@/features/orders/server/guards";
import { activeMembershipWindow } from "./membership-window";
import { grantKey, type PermissionAction, type PermissionKey } from "./rbac";

export type PermissionContext = {
  orgId: string;
  userId: string;
  roleId: string;
  roleKey: string;
  timeZone: string;
};

type RolePermissionRow = { resource: string; action: string; granted: boolean };

type MembershipRow = {
  role_id: string;
  organization_roles: { key: string; role_permissions: RolePermissionRow[] } | null;
};

/**
 * Loads org + membership + the member's full permission set in two
 * queries: the org lookup, then a single nested-embed query on
 * `organization_members` that pulls the role key and every
 * `role_permissions` row for that role in one round trip.
 */
export type LoadReason = "unauthenticated" | "org_not_found" | null;

async function loadContextAndGrants(organizationSlug: string): Promise<{
  context: PermissionContext | null;
  grants: ReadonlySet<PermissionKey>;
  /**
   * Why `context` is null, distinguishing "not signed in" and "org not
   * found" from "signed in, not a member" — `requirePermission` maps the
   * first two to the specific `OrderPermissionError` messages that
   * `requireOrgRole` has always thrown (see guards.ts), which ~40
   * server-action sites map to i18n keys via `permissionMessageKey`.
   * `resolvePermissionsForOrg` ignores this and never throws.
   */
  reason: LoadReason;
}> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { context: null, grants: new Set(), reason: "unauthenticated" };
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("id, default_time_zone")
    .eq("slug", organizationSlug)
    .single();
  if (!org) {
    return { context: null, grants: new Set(), reason: "org_not_found" };
  }

  const { data: member } = await supabase
    .from("organization_members")
    .select("role_id, organization_roles(key, role_permissions(resource, action, granted))")
    .eq("organization_id", org.id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .or(activeMembershipWindow())
    .maybeSingle<MembershipRow>();

  if (!member || !member.organization_roles) {
    return { context: null, grants: new Set(), reason: null };
  }

  const grants = new Set<PermissionKey>(
    member.organization_roles.role_permissions
      .filter((row) => row.granted)
      .map((row) => grantKey(row.resource, row.action as PermissionAction)),
  );

  return {
    context: {
      orgId: org.id,
      userId: user.id,
      roleId: member.role_id,
      roleKey: member.organization_roles.key,
      timeZone: org.default_time_zone,
    },
    grants,
    reason: null,
  };
}

/**
 * Full grant set for an org: nav rendering and client-prop hydration both
 * need it in one place, so the two-query fetch lives here rather than in
 * each caller.
 *
 * NOTE: the plan calls for wrapping this in React's `cache()` for
 * per-request de-duplication. This repo currently pins `react@^18.3.1`,
 * whose stable build does not export `cache` (it landed in React 19 / the
 * 18.3 *canary* channel only) — importing it throws `cache is not a
 * function` at both test time and real Next.js runtime. Left un-memoized
 * until the React 19 upgrade lands; re-add `cache()` then. Callers that
 * need to share one resolution across a request should pass the already
 * -resolved `PermissionContext`/grant set down rather than re-calling this.
 *
 * Also returns `reason` (additive — existing callers that destructure just
 * `{ context, grants }` are unaffected) so a caller that builds its own
 * denial message, rather than throwing through `requirePermission`, can
 * still distinguish "not signed in" / "org not found" from a plain
 * missing-grant denial. See `messageForDenial` below for the shared mapping.
 */
export async function resolvePermissionsForOrg(
  organizationSlug: string,
): Promise<{ context: PermissionContext | null; grants: ReadonlySet<PermissionKey>; reason: LoadReason }> {
  return loadContextAndGrants(organizationSlug);
}

/**
 * The specific message for the two denial reasons `requireOrgRole` has
 * always distinguished (see guards.ts:42-52) — ~40 server-action sites map
 * "Not authenticated" / "Organization not found" to i18n keys via
 * `permissionMessageKey`. Non-member and missing-grant keep the generic
 * default `OrderPermissionError` message, same as before. Shared by
 * `throwForDenial` and by callers (like `resolvePermissionsForOrg` users)
 * that build their own `ActionResult` instead of catching a throw.
 */
export function messageForDenial(reason: LoadReason): string {
  if (reason === "unauthenticated") return "Not authenticated";
  if (reason === "org_not_found") return "Organization not found";
  return new OrderPermissionError().message;
}

function throwForDenial(reason: LoadReason): never {
  throw new OrderPermissionError(messageForDenial(reason));
}

export async function requirePermission(
  organizationSlug: string,
  resource: string,
  action: PermissionAction,
): Promise<PermissionContext> {
  const { context, grants, reason } = await loadContextAndGrants(organizationSlug);
  if (!context || !grants.has(grantKey(resource, action))) {
    throwForDenial(reason);
  }
  return context;
}

export async function requireAnyPermission(
  organizationSlug: string,
  pairs: ReadonlyArray<readonly [string, PermissionAction]>,
): Promise<PermissionContext> {
  const { context, grants, reason } = await loadContextAndGrants(organizationSlug);
  if (!context || !pairs.some(([resource, action]) => grants.has(grantKey(resource, action)))) {
    throwForDenial(reason);
  }
  return context;
}

/**
 * For Server Components that cannot redirect from inside try/catch.
 * Mirrors `requireRoleOrRedirect` in @/features/orders/server/guards.
 */
export async function requirePermissionOrRedirect(
  organizationSlug: string,
  resource: string,
  action: PermissionAction,
): Promise<PermissionContext> {
  try {
    return await requirePermission(organizationSlug, resource, action);
  } catch (e) {
    if (e instanceof OrderPermissionError) {
      // Locale-prefixed explicitly (same pattern as `requireRoleOrRedirect`):
      // a bare path bounces through the middleware's 307 and drops the
      // locale. Stays on `next/navigation`'s `redirect()` via a targeted
      // eslint exemption rather than `@/i18n/navigation` - this module is
      // reachable from unit tests under Vitest's node environment, where
      // `@/i18n/navigation`'s client-navigation build fails to resolve.
      redirect(`/${await getLocale()}/${organizationSlug}`);
    }
    throw e;
  }
}

/**
 * Single-lookup capability check for a known `roleId` (no org/membership
 * round trip). Used by identity-access capability checks that already
 * have the caller's role_id in hand.
 */
export async function actorCan(roleId: string, capability: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("role_permissions")
    .select("resource")
    .eq("role_id", roleId)
    .eq("resource", capability)
    .eq("action", "use")
    .eq("granted", true)
    .maybeSingle();
  return Boolean(data);
}
