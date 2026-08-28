/**
 * Buyer authentication guards for Server Components and Server Actions.
 */

import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PATHNAME_HEADER, toLocaleAgnostic } from "./next-path";

export class NotABuyerError extends Error {
  readonly code = "not_a_buyer";
  constructor(message = "User is not a buyer") {
    super(message);
    this.name = "NotABuyerError";
  }
}

export type Buyer = {
  id: string;
  organization_id: string;
  display_name: string;
  address: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * A `buyers` row exists for whatever organization the account first bought
 * from - `buyers.id = user.id` alone says nothing about *which* org's portal
 * is being viewed. Every portal route carries the org slug in the URL, so
 * callers that know it should pass it here and get treated as logged out on
 * a mismatch, rather than letting an Org A buyer appear fully signed in
 * (their name, their Org A orders) under Org B's branding.
 */
async function buyerBelongsToOrg(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
  organizationSlug: string,
): Promise<boolean> {
  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", organizationSlug)
    .single();
  return !!org && org.id === organizationId;
}

export async function requireBuyer(organizationSlug?: string) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    throw new NotABuyerError("Not authenticated");
  }

  // Check if user has a buyer record
  const { data: buyer, error: buyerError } = await supabase
    .from("buyers")
    .select("*")
    .eq("id", user.id)
    .single();

  if (buyerError || !buyer) {
    throw new NotABuyerError("Not registered as a buyer");
  }

  if (organizationSlug && !(await buyerBelongsToOrg(supabase, buyer.organization_id, organizationSlug))) {
    throw new NotABuyerError("Buyer belongs to a different organization");
  }

  return buyer as Buyer;
}

/** Root of one organization's buyer portal, trailing slash included. */
export function buyerPortalPrefix(organizationSlug: string): string {
  return `/buyer_portal/${organizationSlug}/`;
}

export function buyerLoginPath(organizationSlug: string): string {
  return `${buyerPortalPrefix(organizationSlug)}login`;
}

/**
 * Where to send a buyer back after they sign in: the page they were on, read
 * from the header `src/middleware.ts` sets. Null when there is nothing safe
 * to return to, in which case the login page falls back to the shop.
 *
 * The portal + org prefix is enforced here as well as on the login page: a
 * buyer must never be bounced into another organization's portal, and the
 * value has been through the query string by the time the page sees it.
 */
async function buyerReturnPath(organizationSlug: string): Promise<string | null> {
  // The header is prefixed ("/ms/buyer_portal/{slug}/orders/abc") since
  // `src/middleware.ts` publishes the raw request path - normalize it to
  // locale-agnostic before comparing against `buyerPortalPrefix`, which has
  // no locale segment. See `toLocaleAgnostic`'s doc for why this must not
  // be an open-coded strip.
  const requested = toLocaleAgnostic((await headers()).get(PATHNAME_HEADER));
  if (!requested) return null;

  if (!requested.startsWith(buyerPortalPrefix(organizationSlug))) return null;

  // Returning to the login page itself would just re-open the form.
  const path = requested.split(/[?#]/)[0] ?? requested;
  if (path === buyerLoginPath(organizationSlug)) return null;

  return requested;
}

/**
 * For Server Components that need to redirect if not authenticated.
 *
 * The buyer login page lives under `/buyer_portal/...` like the rest of the
 * portal. This used to redirect to `/{organizationSlug}/login`, which is not
 * a route - buyers whose session had expired hit a 404 instead of the login
 * form.
 */
export async function requireBuyerOrRedirect(organizationSlug: string) {
  try {
    return await requireBuyer(organizationSlug);
  } catch (err) {
    if (err instanceof NotABuyerError) {
      const returnPath = await buyerReturnPath(organizationSlug);
      const qs = returnPath ? `?next=${encodeURIComponent(returnPath)}` : "";
      // Locale-prefixed explicitly (same pattern as `requireUserOrRedirect`):
      // a bare path bounces through the middleware's 307 and drops the
      // locale. Stays on `next/navigation`'s `redirect()` via a targeted
      // eslint exemption rather than `@/i18n/navigation` - this module is
      // reachable from `buyer-auth.test.ts`, and `@/i18n/navigation`'s
      // client-navigation build fails to resolve under Vitest's node
      // environment.
      const locale = await getLocale();
      redirect(`/${locale}${buyerLoginPath(organizationSlug)}${qs}`);
    }
    throw err;
  }
}

/**
 * Check if current user is a buyer (returns null if not). Pass
 * `organizationSlug` to also treat a buyer of a different organization as
 * not logged in for this portal - see `buyerBelongsToOrg`.
 */
export async function getBuyerFromSession(organizationSlug?: string): Promise<Buyer | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: buyer } = await supabase
    .from("buyers")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!buyer) return null;

  if (organizationSlug && !(await buyerBelongsToOrg(supabase, buyer.organization_id, organizationSlug))) {
    return null;
  }

  return buyer as Buyer;
}
