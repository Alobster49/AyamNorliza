import { notFound } from "next/navigation";

import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import {
  getOrganizationBySlug,
  listInvitations,
  listMembers,
} from "@/features/identity-access/server/queries";
import { CAPABILITIES, ROLES, type Role } from "@/lib/auth/permissions";

import { buildCapabilityMatrix } from "@/features/access-control/lib/capability-matrix";
import { CAPABILITY_GROUPS } from "@/features/access-control/lib/group-capabilities";
import { RolesMasthead } from "@/features/access-control/components/roles-masthead";
import { CapabilityMatrix } from "@/features/access-control/components/capability-matrix";
import { RoleRoster } from "@/features/access-control/components/role-roster";
import { RankLadder } from "@/features/access-control/components/rank-ladder";
import { InvitationsQueue } from "@/features/access-control/components/invitations-queue";

export const dynamic = "force-dynamic";

export default async function RolesPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  await requireUserOrRedirect();
  const { organizationSlug } = await params;
  await requirePermissionOrRedirect(organizationSlug, "roles", "view");
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();

  const [allMembers, invitations] = await Promise.all([
    listMembers(org.id),
    listInvitations(org.id),
  ]);
  const activeMembers = allMembers.filter((m) => m.status === "active");

  const matrix = buildCapabilityMatrix();

  // Narrow `member.role` to the typed `Role` so the roster helper stays honest.
  const roleNarrowedMembers = activeMembers
    .map((m) => {
      if ((ROLES as ReadonlyArray<string>).includes(m.role)) {
        return { role: m.role as Role };
      }
      return null;
    })
    .filter((x): x is { role: Role } => x !== null);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-10">
      <RolesMasthead
        organizationName={org.name}
        roleCount={ROLES.length}
        capabilityCount={CAPABILITIES.length}
        groupCount={CAPABILITY_GROUPS.length}
      />

      <div className="mt-10 grid gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-12">
          <CapabilityMatrix data={matrix} />
          <InvitationsQueue invitations={invitations} />
        </div>

        <aside className="space-y-10 lg:sticky lg:top-6 lg:self-start">
          <RoleRoster
            members={roleNarrowedMembers}
            totalMembers={activeMembers.length}
          />
          <RankLadder />
        </aside>
      </div>
    </div>
  );
}
