/**
 * Identity / membership / scope guards for Server Components and Server Actions.
 *
 * Pattern: throw typed errors that the route layer maps to redirects (401) or
 * forbidden pages (403). Never trust middleware alone - re-verify on every
 * protected read or mutation.
 */

import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { activeMembershipWindow } from "./membership-window";
import { PATHNAME_HEADER, toLocaleAgnostic } from "./next-path";

export class PermissionError extends Error {
  readonly code = "permission_denied";
  constructor(message = "Permission denied") {
    super(message);
    this.name = "PermissionError";
  }
}

export class UnauthenticatedError extends Error {
  readonly code = "unauthenticated";
  constructor(message = "Unauthenticated") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

export async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    throw new UnauthenticatedError();
  }
  return user;
}

/**
 * The page the caller is actually on, published by `src/middleware.ts`. Falls back
 * to the caller-supplied path when the middleware did not run for this request
 * (its matcher skips static assets and the auth routes) or when the header
 * fails validation.
 */
async function returnPathFor(fallback?: string): Promise<string | null> {
  const requested = (await headers()).get(PATHNAME_HEADER);
  return toLocaleAgnostic(requested) ?? toLocaleAgnostic(fallback);
}

/**
 * For Server Components that cannot redirect from inside try/catch: use
 * `requireUserOrRedirect()` which calls `next/navigation`'s `redirect()`.
 *
 * `nextPath` is only a fallback now - the real page comes from the middleware
 * header, so a session that expires on `/acme/orders/123` returns there
 * after signing in rather than to the org landing page.
 *
 * `options.requireAal2` adds a second, server-side gate on top of "is signed
 * in": an account with a verified TOTP factor whose session hasn't stepped
 * up past aal1 yet is bounced to `/mfa/challenge` instead of being allowed
 * through. Without this, MFA enforcement lived only in the login form's
 * client-side navigation - a request that skipped that redirect (a stale
 * tab, a direct link, a script) reached the page anyway on an aal1 session.
 * Opt-in rather than the default because most callers of this guard
 * (auth pages, support-sessions, the buyer/drive shells that don't even use
 * it) must never gate on aal2: the enroll and challenge pages need to be
 * reachable at aal1 or the flow can never complete, and enforcing this
 * everywhere would be scope creep beyond the staff dashboard/seller shell
 * this was asked to protect.
 */
export async function requireUserOrRedirect(
  nextPath?: string,
  options?: { requireAal2?: boolean },
) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      const returnPath = await returnPathFor(nextPath);
      const qs = returnPath ? `?next=${encodeURIComponent(returnPath)}` : "";
      const locale = await getLocale();
      redirect(`/${locale}/login${qs}`);
    }
    throw err;
  }

  if (options?.requireAal2) {
    const supabase = await createSupabaseServerClient();
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      const returnPath = await returnPathFor(nextPath);
      const qs = returnPath ? `?next=${encodeURIComponent(returnPath)}` : "";
      const locale = await getLocale();
      redirect(`/${locale}/mfa/challenge${qs}`);
    }
  }

  return user;
}

export type ActiveOrgMember = {
  id: string;
  organization_id: string;
  user_id: string;
  role: string;
  role_id: string;
  status: string;
  starts_at: string;
  expires_at: string | null;
  /** Null only if `role_id` somehow points at a deleted role row -- treat
   * as rank 0 (grant nothing) rather than crashing a picker. */
  organization_roles: { rank: number } | null;
};

export async function requireOrgMember(
  organizationId: string,
): Promise<ActiveOrgMember> {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("organization_members")
    .select(
      "id, organization_id, user_id, role, role_id, status, starts_at, expires_at, organization_roles(rank)",
    )
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .or(activeMembershipWindow())
    .maybeSingle<ActiveOrgMember>();
  if (error) throw error;
  if (!data) throw new PermissionError("Not a member of this organization");
  return data;
}

export async function isActiveOrgMember(
  organizationId: string,
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from("organization_members")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .or(activeMembershipWindow())
    .maybeSingle();
  return Boolean(data);
}
