import { notFound } from "next/navigation";

import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import { getRolesView } from "@/features/identity-access/server/roles";
import { ADMIN_CAPABILITIES } from "@/lib/auth/rbac";

import { ADMIN_CAPABILITY_GROUPS } from "@/features/identity-access/lib/admin-capability-groups";
import { RolesMasthead } from "@/features/access-control/components/roles-masthead";
import { RolesEditor } from "@/features/identity-access/components/roles-editor";

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

  const view = await getRolesView(organizationSlug);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-10">
      <RolesMasthead
        organizationName={org.name}
        roleCount={view.roles.length}
        capabilityCount={ADMIN_CAPABILITIES.length}
        groupCount={ADMIN_CAPABILITY_GROUPS.length}
      />

      <div className="mt-10">
        <RolesEditor
          organizationSlug={organizationSlug}
          roles={view.roles}
          grants={view.grants}
          canEdit={view.canEdit}
        />
      </div>
    </div>
  );
}
