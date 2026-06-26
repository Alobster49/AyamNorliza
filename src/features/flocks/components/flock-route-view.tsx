import { notFound } from "next/navigation";
import { requireOrgMember, requireUserOrRedirect } from "@/lib/auth/require-user";
import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import { FlockDetailClient } from "./flocks-client";
import { getFlock } from "../server/queries";

type FlockView = "overview" | "readiness" | "placement" | "movements" | "harvest" | "closeout";

export function FlockRouteView(view: FlockView) {
  return async function FlockViewPage({
    params,
  }: {
    params: Promise<{ organizationSlug: string; flockId: string }>;
  }) {
    const { organizationSlug, flockId } = await params;
    await requireUserOrRedirect(`/${organizationSlug}/flocks/${flockId}/${view}`);
    const org = await getOrganizationBySlug(organizationSlug);
    if (!org) notFound();
    await requireOrgMember(org.id);
    const flock = await getFlock(flockId);
    if (!flock || flock.organizationId !== org.id) notFound();
    return (
      <FlockDetailClient
        organizationId={org.id}
        organizationSlug={org.slug}
        flock={flock}
        view={view}
      />
    );
  };
}
