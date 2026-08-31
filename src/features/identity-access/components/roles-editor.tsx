"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { resolveMessageKey } from "@/lib/i18n/resolve-message-key";
import { roleDisplayLabel } from "@/features/access-control/components/role-label";
import { PAGE_ACTIONS, grantKey, type PermissionAction, type PermissionKey } from "@/lib/auth/rbac";
import { setPermissionAction, type RoleRow } from "@/features/identity-access/server/roles";
import { CreateRoleDialog } from "./create-role-dialog";
import { RolePermissionsGrid } from "./role-permissions-grid";

/**
 * Mirrors `permissionRows()` in `server/roles.ts` so the toggle reflects the
 * server's cascade immediately (revoking `view` clears the row; granting
 * `add`/`edit`/`delete` implies `view`) instead of waiting on
 * `router.refresh()` for the row to visually settle.
 */
function applyCascade(
  current: ReadonlySet<PermissionKey>,
  resource: string,
  action: PermissionAction,
  granted: boolean,
): Set<PermissionKey> {
  const next = new Set(current);
  if (action === "use") {
    if (granted) next.add(grantKey(resource, action));
    else next.delete(grantKey(resource, action));
    return next;
  }
  if (action === "view" && !granted) {
    for (const a of PAGE_ACTIONS) next.delete(grantKey(resource, a));
    return next;
  }
  if (action !== "view" && granted) {
    next.add(grantKey(resource, "view"));
    next.add(grantKey(resource, action));
    return next;
  }
  if (granted) next.add(grantKey(resource, action));
  else next.delete(grantKey(resource, action));
  return next;
}

function toGrantsById(grants: Record<string, PermissionKey[]>): Record<string, Set<PermissionKey>> {
  return Object.fromEntries(Object.entries(grants).map(([id, keys]) => [id, new Set(keys)]));
}

type RoleListItemProps = {
  role: RoleRow;
  label: string;
  selected: boolean;
  memberCountLabel: string;
  systemBadgeLabel: string;
  onSelect: () => void;
};

export function RolesEditor({
  organizationSlug,
  roles,
  grants: initialGrants,
  canEdit,
}: {
  organizationSlug: string;
  roles: RoleRow[];
  grants: Record<string, PermissionKey[]>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations("identity.rolesEditor");
  const tRoles = useTranslations("roles");
  const tRoot = useTranslations();

  const [selectedRoleId, setSelectedRoleId] = useState<string | undefined>(() => roles[0]?.id);
  const [grantsById, setGrantsById] = useState<Record<string, Set<PermissionKey>>>(() => toGrantsById(initialGrants));
  const [createOpen, setCreateOpen] = useState(false);

  // Resync local optimistic state whenever the server hands down fresh props
  // (after `router.refresh()` from any mutation, including ones made from
  // another tab/session). Adjusted during render rather than in a `useEffect`
  // (React's documented pattern for state derived from a changed prop) so a
  // prop change never renders one extra frame of stale data.
  const [prevInitialGrants, setPrevInitialGrants] = useState(initialGrants);
  if (initialGrants !== prevInitialGrants) {
    setPrevInitialGrants(initialGrants);
    setGrantsById(toGrantsById(initialGrants));
  }

  const [prevRoles, setPrevRoles] = useState(roles);
  if (roles !== prevRoles) {
    setPrevRoles(roles);
    if (!(selectedRoleId && roles.some((r) => r.id === selectedRoleId))) {
      setSelectedRoleId(roles[0]?.id);
    }
  }

  const systemRoles = useMemo(() => roles.filter((r) => r.isSystem), [roles]);
  const customRoles = useMemo(() => roles.filter((r) => !r.isSystem), [roles]);
  const selectedRole = roles.find((r) => r.id === selectedRoleId);

  async function handleToggle(resource: string, action: PermissionAction, granted: boolean) {
    if (!selectedRole) return;
    const roleId = selectedRole.id;
    const previous = grantsById[roleId] ?? new Set<PermissionKey>();
    const next = applyCascade(previous, resource, action, granted);
    setGrantsById((prev) => ({ ...prev, [roleId]: next }));

    const result = await setPermissionAction({ organizationSlug, roleId, resource, action, granted });
    if (!result.ok) {
      setGrantsById((prev) => ({ ...prev, [roleId]: previous }));
      toast({
        title: t("toggleErrorTitle"),
        description: result.messageKey ? resolveMessageKey(tRoot, result.messageKey, result.messageParams) : result.message,
        variant: "destructive",
      });
      return;
    }
    router.refresh();
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
        {canEdit && (
          <Button type="button" className="w-full" onClick={() => setCreateOpen(true)}>
            <Plus />
            {t("newRoleButton")}
          </Button>
        )}

        <nav aria-label={t("systemRolesHeading")} className="space-y-1">
          <RoleGroupHeading>{t("systemRolesHeading")}</RoleGroupHeading>
          <ul className="space-y-1">
            {systemRoles.map((role) => (
              <RoleListItem
                key={role.id}
                role={role}
                label={roleDisplayLabel(tRoles, role)}
                selected={role.id === selectedRoleId}
                memberCountLabel={t("memberCountLabel", { count: role.memberCount })}
                systemBadgeLabel={t("systemBadge")}
                onSelect={() => setSelectedRoleId(role.id)}
              />
            ))}
          </ul>
        </nav>

        {customRoles.length > 0 && (
          <nav aria-label={t("customRolesHeading")} className="space-y-1">
            <RoleGroupHeading>{t("customRolesHeading")}</RoleGroupHeading>
            <ul className="space-y-1">
              {customRoles.map((role) => (
                <RoleListItem
                  key={role.id}
                  role={role}
                  label={roleDisplayLabel(tRoles, role)}
                  selected={role.id === selectedRoleId}
                  memberCountLabel={t("memberCountLabel", { count: role.memberCount })}
                  systemBadgeLabel={t("systemBadge")}
                  onSelect={() => setSelectedRoleId(role.id)}
                />
              ))}
            </ul>
          </nav>
        )}
      </aside>

      <div>
        {selectedRole && (
          <RolePermissionsGrid
            organizationSlug={organizationSlug}
            role={selectedRole}
            grants={grantsById[selectedRole.id] ?? new Set()}
            canEdit={canEdit}
            onToggle={handleToggle}
            onDeleted={() => {
              setSelectedRoleId(undefined);
              router.refresh();
            }}
            onMutated={() => router.refresh()}
          />
        )}
      </div>

      <CreateRoleDialog
        organizationSlug={organizationSlug}
        roles={roles}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(roleId) => {
          setSelectedRoleId(roleId);
          router.refresh();
        }}
      />
    </div>
  );
}

function RoleGroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>
  );
}

function RoleListItem({ role, label, selected, memberCountLabel, systemBadgeLabel, onSelect }: RoleListItemProps) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected}
        className={`flex w-full items-center justify-between gap-2 rounded-2xl px-3 py-2 text-left text-sm transition-colors ${
          selected ? "bg-primary text-primary-foreground" : "hover:bg-muted"
        }`}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{label}</span>
          {role.isSystem && (
            <Badge
              variant={selected ? "outline" : "secondary"}
              className={selected ? "border-primary-foreground/40 text-primary-foreground" : undefined}
            >
              {systemBadgeLabel}
            </Badge>
          )}
        </span>
        <span
          className={`shrink-0 font-mono text-[0.7rem] tabular-nums ${
            selected ? "text-primary-foreground/80" : "text-muted-foreground"
          }`}
        >
          {memberCountLabel}
        </span>
      </button>
    </li>
  );
}
