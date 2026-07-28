import { redirect } from "next/navigation";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { listOrganizationsForCurrentUser } from "@/features/identity-access/server/queries";

export default async function HomePage() {
  await requireUserOrRedirect();
  const orgs = await listOrganizationsForCurrentUser();
  if (orgs.length > 0) {
    redirect(`/${orgs[0]!.slug}/settings/organization`);
  }
  // Signed in but no memberships. Send them to a neutral landing page instead
  // of the signup flow - /signup is for creating a brand new account, and
  // bouncing existing signed-in users there is what caused the "every login
  // takes me to Create account" bug. They should contact their org owner to
  // get an invite.
  redirect("/signup");
}
