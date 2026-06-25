import { notFound } from "next/navigation";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { getOrganizationBySlug, listMembers, listMemberScopes } from "@/features/identity-access/server/queries";
import { UserDetailClient } from "@/features/identity-access/components/user-detail-client";

export default async function UserDetailPage({
  params,
}: {
  params: { organizationSlug: string; userId: string };
}) {
  await requireUserOrRedirect();
  const org = await getOrganizationBySlug(params.organizationSlug);
  if (!org) notFound();
  const members = await listMembers(org.id);
  const member = members.find((m) => m.userId === params.userId);
  if (!member) notFound();
  const scopes = (await listMemberScopes(org.id)).filter((s) => s.organizationMemberId === member.id);
  return (
    <section>
      <h1>Member</h1>
      <UserDetailClient organizationId={org.id} member={member} scopes={scopes} />
    </section>
  );
}
