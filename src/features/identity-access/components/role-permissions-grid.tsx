"use client";

import { useState } from "react";
import { Loader2, Lock, RotateCcw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { resolveMessageKey } from "@/lib/i18n/resolve-message-key";
import {
  RESOURCES,
  PAGE_ACTIONS,
  grantKey,
  type PermissionAction,
  type PermissionKey,
} from "@/lib/auth/rbac";
import { ADMIN_CAPABILITY_GROUPS, toMessageKey } from "@/features/identity-access/lib/admin-capability-groups";
import {
  renameRoleAction,
  deleteRoleAction,
  resetRoleToDefaultsAction,
  type RoleRow,
} from "@/features/identity-access/server/roles";

/** Same visual/aria pattern as `AvailabilitySwitch` / the leave-type-settings
 * row toggle — this repo's convention for a binary on/off control. */
function PermissionToggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? "bg-primary" : "bg-muted-foreground/30"
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ease-out ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

type RolePermissionsGridProps = {
  organizationSlug: string;
  role: RoleRow;
  grants: ReadonlySet<PermissionKey>;
  /** Whether the caller holds `roles:edit` at all — a role-specific lock
   * (owner, or `canEdit=false` org-wide) is layered on top of this. */
  canEdit: boolean;
  onToggle: (resource: string, action: PermissionAction, granted: boolean) => void;
  onDeleted: () => void;
  onMutated: () => void;
};

export function RolePermissionsGrid({
  organizationSlug,
  role,
  grants,
  canEdit,
  onToggle,
  onDeleted,
  onMutated,
}: RolePermissionsGridProps) {
  const { toast } = useToast();
  const t = useTranslations("identity.rolesEditor");
  const tResources = useTranslations("identity.rolesEditor.resources");
  const tCapabilities = useTranslations("identity.rolesEditor.capabilities");
  const tGroups = useTranslations("identity.rolesEditor.groups");
  const tRoot = useTranslations();

  const isOwner = role.key === "owner";
  const locked = isOwner || !canEdit;
  const canManageRole = canEdit && !isOwner;
  const canRename = canManageRole && !role.isSystem;
  const canDelete = canManageRole && !role.isSystem && role.memberCount === 0;

  const [nameDraft, setNameDraft] = useState(role.name);
  const [descriptionDraft, setDescriptionDraft] = useState(role.description ?? "");
  const [savingName, setSavingName] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const dirty = nameDraft !== role.name || descriptionDraft !== (role.description ?? "");

  function showError(title: string, result: { messageKey?: string; message: string; messageParams?: Record<string, string | number> }) {
    toast({
      title,
      description: result.messageKey ? resolveMessageKey(tRoot, result.messageKey, result.messageParams) : result.message,
      variant: "destructive",
    });
  }

  async function handleSaveName() {
    setSavingName(true);
    try {
      const result = await renameRoleAction({
        organizationSlug,
        roleId: role.id,
        name: nameDraft,
        description: descriptionDraft,
      });
      if (!result.ok) {
        showError(t("renameErrorTitle"), result);
        return;
      }
      toast({ title: t("renameSuccess") });
      onMutated();
    } finally {
      setSavingName(false);
    }
  }

  async function handleDelete() {
    const result = await deleteRoleAction({ organizationSlug, roleId: role.id });
    if (!result.ok) {
      showError(t("deleteErrorTitle"), result);
      return;
    }
    toast({ title: t("deleteSuccess") });
    onDeleted();
  }

  async function handleReset() {
    setResetting(true);
    try {
      const result = await resetRoleToDefaultsAction({ organizationSlug, roleId: role.id });
      if (!result.ok) {
        showError(t("resetErrorTitle"), result);
        return;
      }
      toast({ title: t("resetSuccess") });
      onMutated();
    } finally {
      setResetting(false);
    }
  }

  const deleteDisabledReason = isOwner
    ? t("deleteDisabledOwner")
    : role.isSystem
      ? t("deleteDisabledSystem")
      : role.memberCount > 0
        ? t("deleteDisabledHasMembers")
        : null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="space-y-4 rounded-3xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            {role.isSystem && <Badge variant="secondary">{t("systemBadge")}</Badge>}
            <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              {t("memberCountLabel", { count: role.memberCount })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {role.isSystem && !isOwner && (
              <Button type="button" variant="outline" size="sm" disabled={!canEdit || resetting} onClick={() => setResetOpen(true)}>
                {resetting ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                {t("resetButton")}
              </Button>
            )}
            <DeleteButton canDelete={canDelete} reason={deleteDisabledReason} label={t("deleteButton")} onClick={() => setDeleteOpen(true)} />
          </div>
        </div>

        {isOwner && (
          <p className="flex items-center gap-2 rounded-2xl bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            <Lock className="size-4 shrink-0" />
            {t("ownerLockNote")}
          </p>
        )}
        {!canEdit && !isOwner && (
          <p className="rounded-2xl bg-muted/60 px-3 py-2 text-sm text-muted-foreground">{t("readOnlyNote")}</p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="role-name">{t("nameLabel")}</Label>
            <NameField
              id="role-name"
              value={nameDraft}
              onChange={setNameDraft}
              disabled={!canRename}
              disabledReason={
                isOwner ? t("renameDisabledOwner") : role.isSystem ? t("renameDisabledSystem") : undefined
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role-description">{t("descriptionLabel")}</Label>
            <Textarea
              id="role-description"
              value={descriptionDraft}
              onChange={(e) => setDescriptionDraft(e.target.value)}
              disabled={!canRename}
              rows={1}
            />
          </div>
        </div>

        {canRename && dirty && (
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={savingName}
              onClick={() => {
                setNameDraft(role.name);
                setDescriptionDraft(role.description ?? "");
              }}
            >
              {t("cancel")}
            </Button>
            <Button type="button" size="sm" disabled={savingName || !nameDraft.trim()} onClick={() => void handleSaveName()}>
              {savingName && <Loader2 className="animate-spin" />}
              {t("save")}
            </Button>
          </div>
        )}
      </div>

      {/* Pages */}
      <Card>
        <CardHeader>
          <CardTitle>{t("pagesHeading")}</CardTitle>
          <CardDescription>{t("pagesDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-2 font-medium">{t("colResource")}</th>
                {PAGE_ACTIONS.map((action) => (
                  <th key={action} className="px-3 py-2 text-center font-medium">
                    {t(`col${capitalize(action)}` as never)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RESOURCES.map((resource) => (
                <tr key={resource} className="border-b border-border/60 last:border-0">
                  <td className="px-5 py-3 font-medium">{tResources(toMessageKey(resource) as never)}</td>
                  {PAGE_ACTIONS.map((action) => {
                    const key = grantKey(resource, action);
                    const checked = grants.has(key);
                    return (
                      <td key={action} className="px-3 py-3 text-center">
                        <div className="flex justify-center">
                          <PermissionToggle
                            checked={checked}
                            disabled={locked}
                            onChange={(next) => onToggle(resource, action, next)}
                            label={t("toggleAriaLabel", {
                              action: t(`col${capitalize(action)}` as never),
                              resource: tResources(toMessageKey(resource) as never),
                            })}
                          />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Administration */}
      <Card>
        <CardHeader>
          <CardTitle>{t("adminHeading")}</CardTitle>
          <CardDescription>{t("adminDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          {ADMIN_CAPABILITY_GROUPS.map((group) => (
            <div key={group.id} className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {tGroups(group.id as never)}
              </h4>
              <ul className="space-y-3">
                {group.capabilities.map((capability) => {
                  const key = grantKey(capability, "use");
                  const checked = grants.has(key);
                  const capKey = toMessageKey(capability);
                  return (
                    <li key={capability} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{tCapabilities(`${capKey}.label` as never)}</p>
                        <p className="text-xs text-muted-foreground">{tCapabilities(`${capKey}.description` as never)}</p>
                      </div>
                      <PermissionToggle
                        checked={checked}
                        disabled={locked}
                        onChange={(next) => onToggle(capability, "use", next)}
                        label={tCapabilities(`${capKey}.label` as never)}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("confirmDeleteTitle", { role: role.name })}
        description={t("confirmDeleteDescription")}
        confirmLabel={t("deleteButton")}
        onConfirm={handleDelete}
      />
      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={t("resetConfirmTitle", { role: role.name })}
        description={t("resetConfirmDescription")}
        confirmLabel={t("resetButton")}
        onConfirm={handleReset}
      />
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function NameField({
  id,
  value,
  onChange,
  disabled,
  disabledReason,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const input = (
    <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
  );
  if (!disabled || !disabledReason) return input;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block">{input}</span>
      </TooltipTrigger>
      <TooltipContent>{disabledReason}</TooltipContent>
    </Tooltip>
  );
}

function DeleteButton({
  canDelete,
  reason,
  label,
  onClick,
}: {
  canDelete: boolean;
  reason: string | null;
  label: string;
  onClick: () => void;
}) {
  const button = (
    <Button type="button" variant="outline" size="sm" disabled={!canDelete} onClick={onClick}>
      <Trash2 />
      {label}
    </Button>
  );
  if (canDelete || !reason) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{button}</span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
