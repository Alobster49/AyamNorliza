import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { getOrganizationBySlug, listSupportSessions, listMembers } from "@/features/identity-access/server/queries";
import { SupportSessionsClient } from "@/features/identity-access/components/support-sessions-client";

export default async function SupportSessionsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  await requireUserOrRedirect();
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();
  const [sessions, members] = await Promise.all([listSupportSessions(org.id), listMembers(org.id)]);
  const t = await getTranslations("settings.supportSessions");
  return (
    <section>
      <h1>{t("title")}</h1>
      <SupportSessionsClient organizationId={org.id} sessions={sessions} members={members} />
    </section>
  );
}
