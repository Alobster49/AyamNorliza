import Link from "next/link";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { listOrganizationsForCurrentUser } from "@/features/identity-access/server/queries";

export const metadata = { title: "No organization - AyamNorliza" };

export default async function NoOrganizationPage() {
  const user = await requireUserOrRedirect();
  const orgs = await listOrganizationsForCurrentUser();

  if (orgs.length > 0) {
    // Should not normally happen because the root / page would have sent the
    // user to the dashboard, but handle it defensively.
    return (
      <main style={{ maxWidth: 640, margin: "4rem auto", padding: "1.5rem" }}>
        <h1>Choose an organization</h1>
        <ul>
          {orgs.map((org) => (
            <li key={org.id}>
              <Link href={`/${org.slug}/overview`}>{org.name}</Link>
            </li>
          ))}
        </ul>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 640, margin: "4rem auto", padding: "1.5rem" }}>
      <h1>You don&apos;t have an organization yet</h1>
      <p>
        You&apos;re signed in as <strong>{user.email}</strong>, but your account
        isn&apos;t a member of any organization yet.
      </p>
      <p>
        New accounts are invite-only. Ask your organization owner to send you an
        invitation, then check your email for the invite link.
      </p>
      <p style={{ marginTop: "1.5rem" }}>
        <Link href="/login">Back to sign in</Link>
      </p>
    </main>
  );
}