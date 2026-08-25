import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { requireOrgMember } from "@/lib/auth/require-user";
import {
  getOrganizationBySlug,
  listMembers,
  listInvitations,
  listMemberScopes,
  listProfilesByUserIds,
} from "@/features/identity-access/server/queries";
import { adminGetMemberEmails } from "@/features/identity-access/server/admin-queries";
import { mergeMemberDirectory } from "@/features/identity-access/directory";
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
  const userIds = Array.from(new Set(members.map((m) => m.userId)));
  const [displayNames, emails] = await Promise.all([
    listProfilesByUserIds(userIds),
    adminGetMemberEmails(userIds),
  ]);
  const memberRows = mergeMemberDirectory(members, displayNames, emails);

  return (
    <section>
      <h1>{t("title")}</h1>
      <UsersPageClient
        organizationId={org.id}
        organizationSlug={org.slug}
        members={memberRows}
        invitations={invitations}
        scopes={scopes}
      />
    </section>
  );
}
