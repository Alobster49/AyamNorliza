import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { resolveLandingPath } from "@/features/identity-access/server/landing";

export default async function HomePage() {
  await requireUserOrRedirect();
  // Signed in but with no memberships this resolves to /signup. That is a
  // neutral landing page rather than the signup flow proper - existing users
  // should contact their org owner for an invite.
  redirect({ href: await resolveLandingPath(), locale: await getLocale() });
}
