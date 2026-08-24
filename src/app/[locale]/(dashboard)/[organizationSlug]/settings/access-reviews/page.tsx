import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { getOrganizationBySlug, listAccessReviews, listAccessReviewItems, listMembers } from "@/features/identity-access/server/queries";
import { AccessReviewsClient } from "@/features/identity-access/components/access-reviews-client";

export default async function AccessReviewsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  await requireUserOrRedirect();
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();
  const reviews = await listAccessReviews(org.id);
  const members = await listMembers(org.id);
  const itemLists = await Promise.all(reviews.map((r) => listAccessReviewItems(r.id)));
  const t = await getTranslations("settings.accessReviews");
  return (
    <section>
      <h1>{t("title")}</h1>
      <AccessReviewsClient
        organizationId={org.id}
        reviews={reviews}
        members={members}
        itemsByReview={Object.fromEntries(reviews.map((r, i) => [r.id, itemLists[i] ?? []]))}
      />
    </section>
  );
}
