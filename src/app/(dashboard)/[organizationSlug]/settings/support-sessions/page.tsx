import { notFound } from "next/navigation";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { getOrganizationBySlug, listSupportSessions, listMembers } from "@/features/identity-access/server/queries";
import { SupportSessionsClient } from "@/features/identity-access/components/support-sessions-client";

export default async function SupportSessionsPage({
  params,
}: {
  params: { organizationSlug: string };
}) {
  await requireUserOrRedirect();
  const org = await getOrganizationBySlug(params.organizationSlug);
  if (!org) notFound();
  const [sessions, members] = await Promise.all([listSupportSessions(org.id), listMembers(org.id)]);
  return (
    <section>
      <h1>Support sessions</h1>
      <SupportSessionsClient organizationId={org.id} sessions={sessions} members={members} />
    </section>
  );
}
