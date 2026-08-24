"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { resolveMessageKey } from "@/lib/i18n/resolve-message-key";
import {
  AlertTriangle,
  Check,
  Crown,
  Info,
  Loader2,
  Lock,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ReauthDialog } from "@/components/forms/reauth-dialog";
import { roleLabelKey } from "@/features/access-control/components/role-label";
import {
  type Capability,
  type Role,
} from "@/lib/auth/permissions";
import {
  type CapabilityArea,
  type RoleCapabilityCell,
  type RoleView,
  type RolesViewModel,
} from "@/features/identity-access/server/roles";
import {
  resetRoleToDefaultsAction,
  updateRoleCapabilityAction,
} from "@/features/identity-access/server/roles";

// Capability area metadata used by the section layout. Server-side is the
// source of truth for which capability belongs to which area; the client
// just needs an ordered list of ids — labels/descriptions are resolved via
// `identity.rolesPage.areas.<id>.{label,description}` at render time.
const CAPABILITY_AREA_GROUPS: ReadonlyArray<{ id: CapabilityArea }> = [
  { id: "organization" },
  { id: "membership" },
  { id: "access_review" },
  { id: "support" },
  { id: "break_glass" },
  { id: "audit" },
];

// ---------------------------------------------------------------------------
// TogglePill: minimal accessible switch built from primitives (no shadcn
// Switch component is installed in this project). Role:switch + aria-checked
// keeps assistive tech happy.
// ---------------------------------------------------------------------------

function TogglePill(props: {
  granted: boolean;
  disabled: boolean;
  onToggle: () => void;
  label: string;
}) {
  const { granted, disabled, onToggle, label } = props;
  const t = useTranslations("identity.rolesPage");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          role="switch"
          aria-checked={granted}
          aria-label={label}
          disabled={disabled}
          onClick={onToggle}
          className="group relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-all focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          data-state={granted ? "on" : "off"}
          data-delta={granted ? "granted" : "revoked"}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full bg-muted transition-colors group-data-[state=on]:bg-foreground"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute left-0.5 size-6 rounded-full bg-background shadow-sm transition-transform group-data-[state=on]:translate-x-5"
          />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {t("toggleTooltip", {
          state: granted ? t("tooltipEnabled") : t("tooltipDisabled"),
          action: granted ? t("actionRevoke") : t("actionGrant"),
        })}
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// CapabilityToggle: a single row in the matrix for one capability on one role.
// ---------------------------------------------------------------------------

function CapabilityToggle(props: {
  role: Role;
  cell: RoleCapabilityCell;
  canEdit: boolean;
  onToggle: (role: Role, capability: Capability, granted: boolean) => void;
  pending: boolean;
}) {
  const { role, cell, canEdit, onToggle, pending } = props;
  const t = useTranslations("identity.rolesPage");

  const lockedReason = !cell.isEditableRole
    ? role === "owner"
      ? t("lockedReasonOwner")
      : t("lockedReasonRoleLocked")
    : !cell.isOverridable
      ? t("lockedReasonNotOverridable")
      : null;
  const disabled = !canEdit || Boolean(lockedReason) || pending;

  const delta = cell.granted !== cell.defaultGranted;
  const DeltaIcon: LucideIcon = cell.granted ? Sparkles : TriangleAlert;
  const deltaLabel = delta
    ? cell.granted
      ? t("grantedByOverride")
      : t("revokedByOverride")
    : null;

  return (
    <div
      className="flex items-start justify-between gap-4 rounded-2xl border border-border/70 bg-background p-4 transition-colors data-[state=off]:bg-muted/30"
      data-state={cell.granted ? "on" : "off"}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium leading-none">{cell.label}</span>
          <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {cell.capability}
          </code>
          {!cell.isOverridable ? (
            <Badge variant="outline" className="gap-1 text-muted-foreground">
              <Lock className="size-3" aria-hidden /> {t("legendLockedBadge")}
            </Badge>
          ) : null}
          {!cell.isEditableRole && role !== "owner" ? (
            <Badge variant="secondary" className="gap-1">
              {t("roleLocked")}
            </Badge>
          ) : null}
          {delta ? (
            <Badge
              variant={cell.granted ? "default" : "destructive"}
              className="gap-1"
              aria-label={deltaLabel ?? undefined}
            >
              <DeltaIcon className="size-3" aria-hidden /> {deltaLabel}
            </Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {lockedReason ?? cell.description}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          {cell.granted ? t("toggleOn") : t("toggleOff")}
        </span>
        <TogglePill
          granted={cell.granted}
          disabled={disabled}
          onToggle={() => onToggle(role, cell.capability, !cell.granted)}
          label={t("toggleAriaLabel", { label: cell.label, role })}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RoleColumn: one role's capabilities grouped by area.
// ---------------------------------------------------------------------------

function RoleColumn(props: {
  role: Role;
  view: RoleView;
  canEdit: boolean;
  pendingOverrides: Set<string>;
  onToggle: (role: Role, capability: Capability, granted: boolean) => void;
  onReset: (role: Role) => void;
}) {
  const { role, view, canEdit, pendingOverrides, onToggle, onReset } = props;
  const t = useTranslations("identity.rolesPage");
  const grantCount = useMemo(
    () => view.cells.filter((c) => c.granted).length,
    [view.cells],
  );
  const overrideCount = useMemo(
    () => view.cells.filter((c) => c.isOverridden).length,
    [view.cells],
  );

  const cellsByArea = useMemo(() => {
    const grouped = new Map<CapabilityArea, RoleCapabilityCell[]>();
    for (const c of view.cells) {
      const list = grouped.get(c.area) ?? [];
      list.push(c);
      grouped.set(c.area, list);
    }
    return grouped;
  }, [view.cells]);

  return (
    <TabsContent value={role} className="m-0 flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            {role === "owner" ? (
              <Crown className="size-5 text-amber-500" aria-hidden />
            ) : (
              <ShieldAlert className="size-5 text-muted-foreground" aria-hidden />
            )}
            <h2 className="text-xl font-semibold tracking-tight">{view.label}</h2>
            <Badge variant="outline" className="uppercase">
              {t("rank", { rank: view.rank })}
            </Badge>
            {view.isOwnerLocked ? (
              <Badge variant="secondary" className="gap-1">
                <Lock className="size-3" aria-hidden /> {t("ownerLocked")}
              </Badge>
            ) : null}
            {overrideCount > 0 ? (
              <Badge className="gap-1">
                <Sparkles className="size-3" aria-hidden /> {t("overridesBadge", { count: overrideCount })}
              </Badge>
            ) : null}
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">{view.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {t("capabilitiesEnabled", { granted: grantCount, total: view.cells.length })}
          </Badge>
          {canEdit && !view.isOwnerLocked && overrideCount > 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={() => onReset(role)}>
              <RotateCcw className="size-3.5" aria-hidden /> {t("resetToDefaults")}
            </Button>
          ) : null}
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-8">
        {CAPABILITY_AREA_GROUPS.map((area) => {
          const cells = cellsByArea.get(area.id) ?? [];
          if (cells.length === 0) return null;
          const enabledInArea = cells.filter((c) => c.granted).length;
          return (
            <section key={area.id} className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {t(`areas.${area.id}.label`)}
                  </h3>
                  <p className="text-xs text-muted-foreground">{t(`areas.${area.id}.description`)}</p>
                </div>
                <Badge variant="outline" className="text-xs">
                  {enabledInArea}/{cells.length}
                </Badge>
              </div>
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                {cells.map((cell) => {
                  const key = `${role}:${cell.capability}`;
                  return (
                    <CapabilityToggle
                      key={key}
                      role={role}
                      cell={cell}
                      canEdit={canEdit}
                      onToggle={onToggle}
                      pending={pendingOverrides.has(key)}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </TabsContent>
  );
}

// ---------------------------------------------------------------------------
// RolesPageClient: top-level editable matrix.
// ---------------------------------------------------------------------------

export function RolesPageClient(props: {
  view: RolesViewModel;
  canEdit: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("identity.rolesPage");
  const tRoot = useTranslations();
  const format = useFormatter();
  const [view, setView] = useState<RolesViewModel>(props.view);
  const [pendingOverrides, setPendingOverrides] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [isRefreshing, startRefresh] = useTransition();

  const [confirmToggle, setConfirmToggle] = useState<{
    role: Role;
    capability: Capability;
    next: boolean;
  } | null>(null);
  const [confirmReset, setConfirmReset] = useState<Role | null>(null);
  const [reauth, setReauth] = useState<{
    open: boolean;
    pending: null | (() => Promise<ActionResultLite>);
  }>({ open: false, pending: null });

  const refresh = useCallback(() => {
    startRefresh(() => {
      router.refresh();
    });
  }, [router]);

  const onToggle = useCallback((role: Role, capability: Capability, next: boolean) => {
    setConfirmToggle({ role, capability, next });
  }, []);

  const onReset = useCallback((role: Role) => {
    setConfirmReset(role);
  }, []);

  const applyToggle = useCallback(
    async (role: Role, capability: Capability, next: boolean, reason: string) => {
      const key = `${role}:${capability}`;
      setError(null);
      setPendingOverrides((prev) => new Set(prev).add(key));
      const result = await updateRoleCapabilityAction({
        organizationId: view.organizationId,
        role,
        capability,
        granted: next,
        reason,
      });
      setPendingOverrides((prev) => {
        const nextSet = new Set(prev);
        nextSet.delete(key);
        return nextSet;
      });
      if (!result.ok) {
        if (result.code === "reauth_required") {
          setReauth({
            open: true,
            pending: () =>
              updateRoleCapabilityAction({
                organizationId: view.organizationId,
                role,
                capability,
                granted: next,
                reason,
              }),
          });
          return;
        }
        // `messageKey` is a dynamic full path (e.g. "errors.identity.roles.notEditable");
        // next-intl's typed `t()` only accepts literal keys, so this is cast at the call site.
        setError(resolveMessageKey(tRoot, result.messageKey!, result.messageParams));
        return;
      }
      setView((prev) => withCell(prev, role, capability, next));
      setSavedFlash(t("saved"));
      setTimeout(() => setSavedFlash(null), 1500);
      refresh();
    },
    [view.organizationId, refresh, t, tRoot],
  );

  const applyReset = useCallback(
    async (role: Role, reason: string) => {
      setError(null);
      setView((prev) => withResetRole(prev, role));
      const result = await resetRoleToDefaultsAction({
        organizationId: view.organizationId,
        role,
        reason,
      });
      if (!result.ok) {
        if (result.code === "reauth_required") {
          setReauth({
            open: true,
            pending: () =>
              resetRoleToDefaultsAction({
                organizationId: view.organizationId,
                role,
                reason,
              }),
          });
          return;
        }
        // `messageKey` is a dynamic full path (e.g. "errors.identity.roles.notEditable");
        // next-intl's typed `t()` only accepts literal keys, so this is cast at the call site.
        setError(resolveMessageKey(tRoot, result.messageKey!, result.messageParams));
        return;
      }
      setSavedFlash(t("saved"));
      setTimeout(() => setSavedFlash(null), 1500);
      refresh();
    },
    [view.organizationId, refresh, t, tRoot],
  );

  const roles = view.roles;
  const defaultRole = roles[0]?.role ?? "owner";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-muted-foreground" aria-hidden />
              <h1 className="text-2xl font-semibold tracking-tight">
                {t("title")}
              </h1>
              {view.isOwner ? (
                <Badge className="gap-1">
                  <Crown className="size-3" aria-hidden /> {t("editingAsOwner")}
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1">
                  <Lock className="size-3" aria-hidden /> {t("readOnly")}
                </Badge>
              )}
              {savedFlash ? (
                <Badge variant="outline" className="gap-1 text-foreground">
                  <Check className="size-3" aria-hidden /> {savedFlash}
                </Badge>
              ) : null}
              {isRefreshing ? (
                <Badge variant="outline" className="gap-1 text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" aria-hidden /> {t("syncing")}
                </Badge>
              ) : null}
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {t("description")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{t("statsRoles", { count: view.totals.roles })}</Badge>
            <Badge variant="outline">{t("statsCapabilities", { count: view.totals.capabilities })}</Badge>
            <Badge variant="outline">
              {t("statsOverrides", { count: view.totals.overrides })}
              {view.lastEditedAt
                ? t("statsLastEdited", { time: format.relativeTime(new Date(view.lastEditedAt)) })
                : ""}
            </Badge>
          </div>
        </div>
        {error ? (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="space-y-0.5">
              <p className="font-medium">{t("errorTitle")}</p>
              <p className="text-destructive/90">{error}</p>
            </div>
          </div>
        ) : null}
      </header>

      <Tabs defaultValue={defaultRole} className="flex flex-col gap-6 lg:flex-row">
        <aside className="lg:w-64 lg:shrink-0">
          <Card>
            <CardHeader>
              <CardTitle>{t("rolesCardTitle")}</CardTitle>
              <CardDescription>
                {t("rolesCardDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-2">
              <TabsList
                variant="line"
                className="flex h-auto w-full flex-col gap-0.5 bg-transparent p-0"
              >
                {roles.map((role) => {
                  const overrideCount = role.cells.filter((c) => c.isOverridden).length;
                  const grantedCount = role.cells.filter((c) => c.granted).length;
                  return (
                    <TabsTrigger
                      key={role.role}
                      value={role.role}
                      className="w-full justify-between"
                    >
                      <span className="flex items-center gap-2 truncate">
                        {role.role === "owner" ? (
                          <Crown className="size-3.5 text-amber-500" aria-hidden />
                        ) : null}
                        <span className="truncate">{role.label}</span>
                      </span>
                      {overrideCount > 0 ? (
                        <Badge variant="outline" className="ml-auto text-[10px]">
                          {overrideCount}
                        </Badge>
                      ) : (
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {t("grantedOn", { count: grantedCount })}
                        </span>
                      )}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>{t("legendTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2 text-xs text-muted-foreground">
                <li className="flex items-center gap-2">
                  <span className="inline-flex size-2.5 rounded-full bg-foreground" />
                  {t("legendOn")}
                </li>
                <li className="flex items-center gap-2">
                  <span className="inline-flex size-2.5 rounded-full bg-amber-500" />
                  {t("legendOverride")}
                </li>
                <li className="flex items-center gap-2">
                  <span className="inline-flex size-2.5 rounded-full bg-muted-foreground/30" />
                  {t("legendOff")}
                </li>
                <li className="flex items-center gap-2">
                  <Lock className="size-3.5" aria-hidden />
                  {t("legendLocked")}
                </li>
              </ul>
            </CardContent>
          </Card>
        </aside>

        <div className="min-w-0 flex-1">
          {roles.map((role) => (
            <RoleColumn
              key={role.role}
              role={role.role}
              view={role}
              canEdit={view.canEdit}
              pendingOverrides={pendingOverrides}
              onToggle={onToggle}
              onReset={onReset}
            />
          ))}
        </div>
      </Tabs>

      <ConfirmationDialog
        confirm={confirmToggle}
        onCancel={() => setConfirmToggle(null)}
        onConfirm={async (reason) => {
          if (!confirmToggle) return;
          const { role, capability, next } = confirmToggle;
          setConfirmToggle(null);
          await applyToggle(role, capability, next, reason);
        }}
      />

      <ResetDialog
        role={confirmReset}
        onCancel={() => setConfirmReset(null)}
        onConfirm={async (reason) => {
          if (!confirmReset) return;
          const role = confirmReset;
          setConfirmReset(null);
          await applyReset(role, reason);
        }}
      />

      <ReauthDialogLite
        open={reauth.open}
        onClose={() => setReauth({ open: false, pending: null })}
        pending={reauth.pending}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirmation dialog (grant / revoke one capability)
// ---------------------------------------------------------------------------

function ConfirmationDialog(props: {
  confirm: { role: Role; capability: Capability; next: boolean } | null;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const { confirm, onCancel, onConfirm } = props;
  const t = useTranslations("identity.rolesPage");
  const tRoles = useTranslations("roles");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);

  if (!confirm) return null;
  const valid = reason.trim().length >= 10;
  const isOverride = confirm.next ? t("dialogDescGrant") : t("dialogDescRevoke");

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {confirm.next ? t("grantTitle") : t("revokeTitle")}
          </DialogTitle>
          <DialogDescription>
            <code className="rounded bg-muted px-1.5 py-0.5">{confirm.capability}</code>{" "}
            {t("onRole", { role: tRoles(roleLabelKey(confirm.role)) })} {isOverride}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="override-reason">{t("reasonLabel")}</Label>
          <Input
            id="override-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("reasonPlaceholder")}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            {t("reasonHint")}
          </p>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={pending}>
              {t("cancel")}
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={!valid || pending}
            onClick={async () => {
              setPending(true);
              try {
                await onConfirm(reason.trim());
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {confirm.next ? t("grant") : t("revoke")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Reset dialog
// ---------------------------------------------------------------------------

function ResetDialog(props: {
  role: Role | null;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const { role, onCancel, onConfirm } = props;
  const t = useTranslations("identity.rolesPage");
  const tRoles = useTranslations("roles");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);

  if (!role) return null;
  const valid = reason.trim().length >= 10;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("resetTitle")}</DialogTitle>
          <DialogDescription>
            {t("resetDescription", { role: tRoles(roleLabelKey(role)) })}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              {t("resetInfo")}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="reset-reason">{t("resetReasonLabel")}</Label>
          <Input
            id="reset-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("resetReasonPlaceholder")}
            autoFocus
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={pending}>
              {t("cancel")}
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={!valid || pending}
            onClick={async () => {
              setPending(true);
              try {
                await onConfirm(reason.trim());
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t("resetButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Reauth wrapper (reuses the existing form)
// ---------------------------------------------------------------------------

function ReauthDialogLite(props: {
  open: boolean;
  onClose: () => void;
  pending: null | (() => Promise<ActionResultLite>);
}) {
  const { open, onClose, pending } = props;
  if (!open) return null;
  return (
    <ReauthDialog
      open={open}
      onClose={onClose}
      onSuccess={() => {
        onClose();
      }}
      retryAction={async () => {
        if (!pending) return { ok: true };
        const result = await pending();
        if (!result.ok) {
          return {
            ok: false,
            code: result.code,
            message: result.message,
            messageKey: result.messageKey,
            messageParams: result.messageParams,
          };
        }
        return { ok: true };
      }}
    />
  );
}

type ActionResultLite = {
  ok: boolean;
  code?: string;
  message?: string;
  messageKey?: string;
  messageParams?: Record<string, string | number>;
};

// ---------------------------------------------------------------------------
// Pure helpers (kept out of the render path so editors can refactor freely)
// ---------------------------------------------------------------------------

function withCell(
  view: RolesViewModel,
  role: Role,
  capability: Capability,
  granted: boolean,
): RolesViewModel {
  const roles = view.roles.map((rv) => {
    if (rv.role !== role) return rv;
    const cells = rv.cells.map((c) =>
      c.capability === capability
        ? { ...c, granted, isOverridden: granted !== c.defaultGranted }
        : c,
    );
    return { ...rv, cells };
  });
  return { ...view, roles };
}

function withResetRole(view: RolesViewModel, role: Role): RolesViewModel {
  const roles = view.roles.map((rv) => {
    if (rv.role !== role) return rv;
    const cells = rv.cells.map((c) => ({
      ...c,
      granted: c.defaultGranted,
      isOverridden: false,
    }));
    return { ...rv, cells };
  });
  return { ...view, roles };
}

// Public re-export so downstream consumers can pin the area type.
export type { CapabilityArea };
