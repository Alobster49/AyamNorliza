/**
 * Identity / membership / scope guards for Server Components and Server Actions.
 *
 * Pattern: throw typed errors that the route layer maps to redirects (401) or
 * forbidden pages (403). Never trust middleware alone - re-verify on every
 * protected read or mutation.
 */

import "server-only";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
 * For Server Components that cannot redirect from inside try/catch: use
 * `requireUserOrRedirect()` which calls `next/navigation`'s `redirect()`.
 */
export async function requireUserOrRedirect(nextPath?: string) {
  try {
    return await requireUser();
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      const qs = nextPath ? `?next=${encodeURIComponent(nextPath)}` : "";
      redirect(`/login${qs}`);
    }
    throw err;
  }
}

export type ActiveOrgMember = {
  id: string;
  organization_id: string;
  user_id: string;
  role: string;
  status: string;
  starts_at: string;
  expires_at: string | null;
};

export async function requireOrgMember(
  organizationId: string,
): Promise<ActiveOrgMember> {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("organization_members")
    .select("id, organization_id, user_id, role, status, starts_at, expires_at")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .is("expires_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new PermissionError("Not a member of this organization");
  return data as ActiveOrgMember;
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
    .is("expires_at", null)
    .maybeSingle();
  return Boolean(data);
}
