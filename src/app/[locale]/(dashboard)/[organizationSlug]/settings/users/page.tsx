import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { requireOrgMember } from "@/lib/auth/require-user";
import { getOrganizationBySlug, listMembers, listInvitations, listMemberScopes } from "@/features/identity-access/server/queries";
import { UsersPageClient } from "@/features/identity-access/components/users-page-client";

export default async function UsersSettingsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  await requireUserOrRedirect();
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();
  // Confirms membership (RLS would deny on list queries if not a member).
  await requireOrgMember(org.id);

  const [members, invitations, scopes, t] = await Promise.all([
    listMembers(org.id),
    listInvitations(org.id),
    listMemberScopes(org.id),
    getTranslations("settings.users"),
  ]);

  return (
    <section>
      <h1>{t("title")}</h1>
      <UsersPageClient
        organizationId={org.id}
        organizationSlug={org.slug}
        members={members}
        invitations={invitations}
        scopes={scopes}
      />
    </section>
  );
}
