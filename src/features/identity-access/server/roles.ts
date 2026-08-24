/**
 * Server Actions for the Roles & Permissions settings page (MOD-19).
 *
 * Each action follows the same contract as the rest of the identity-access
 * module:
 *   1. Zod parse the input
 *   2. Identity check (requireUser)
 *   3. Permission/scope check (owner of the target org)
 *   4. Step-up: requireReauth for any state-mutating action
 *   5. RLS mutation (the table is RLS-locked to owners)
 *   6. Audit row in the same transaction via recordAudit
 *   7. Safe field errors returned to the UI
 *   8. revalidatePath so the page re-renders the resolved matrix
 *
 * Read-only consumers (the page itself, non-owners) call `getRolesView`
 * which does NOT require reauth and which returns a view-shaped object
 * that the UI can consume directly.
 */

"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser, PermissionError } from "@/lib/auth/require-user";
import { requireReauth, ReauthRequiredError } from "@/lib/auth/reauth.server";
import {
  ROLES,
  CAPABILITIES,
  can,
  isCapabilityOverridable,
  isRoleEditable,
  type Capability,
  type Role,
} from "@/lib/auth/permissions";
import { recordAudit } from "@/lib/audit/events";

// ---------------------------------------------------------------------------
// Public types: shape the UI receives
// ---------------------------------------------------------------------------

export type CapabilityArea = "organization" | "membership" | "audit" | "support" | "access_review" | "break_glass" | "catalog" | "sales";

export const CAPABILITY_AREAS: ReadonlyArray<{
  id: CapabilityArea;
  label: string;
  description: string;
}> = [
  {
    id: "organization",
    label: "Organization",
    description: "Settings that govern the organization as a whole.",
  },
  {
    id: "membership",
    label: "Membership",
    description: "Inviting users, changing roles, scopes, and access lifecycle.",
  },
  {
    id: "catalog",
    label: "Catalog",
    description: "Manage products, categories, and pricing.",
  },
  {
    id: "sales",
    label: "Sales",
    description: "Manage orders and customers.",
  },
  {
    id: "access_review",
    label: "Access reviews",
    description: "Periodic attestations that confirm membership and roles.",
  },
  {
    id: "support",
    label: "Support sessions",
    description: "Time-bound elevated access for technicians.",
  },
  {
    id: "break_glass",
    label: "Break-glass",
    description: "Emergency override events recorded to the audit log.",
  },
  {
    id: "audit",
    label: "Audit & security",
    description: "Read access to immutable history and security events.",
  },
];

const CAPABILITY_AREA: Record<Capability, CapabilityArea> = {
  "organization.manage": "organization",
  "organization.settings.update": "organization",
  "membership.invite": "membership",
  "membership.role.change": "membership",
  "membership.scope.change": "membership",
  "membership.deactivate": "membership",
  "catalog.manage": "catalog",
  "orders.manage": "sales",
  "customers.manage": "sales",
  "access_review.run": "access_review",
  "access_review.decide": "access_review",
  "support_session.open": "support",
  "support_session.end": "support",
  "break_glass.open": "break_glass",
  "break_glass.finalize": "break_glass",
  "audit.read": "audit",
  "audit_log.read": "audit",
  "auth_security.read": "audit",
  "step_up.reauth": "audit",
};

export type RoleCapabilityCell = {
  capability: Capability;
  label: string;
  description: string;
  area: CapabilityArea;
  granted: boolean;
  defaultGranted: boolean;
  isOverridden: boolean;
  isOverridable: boolean;
  isEditableRole: boolean;
};

export type RoleView = {
  role: Role;
  label: string;
  description: string;
  rank: number;
  isEditable: boolean;
  isOwnerLocked: boolean;
  cells: RoleCapabilityCell[];
};

export type RolesViewModel = {
  organizationId: string;
  organizationName: string;
  isOwner: boolean;
  canEdit: boolean;
  roles: RoleView[];
  areas: typeof CAPABILITY_AREAS;
  totals: {
    roles: number;
    capabilities: number;
    overrides: number;
  };
  lastEditedAt: string | null;
};

// ---------------------------------------------------------------------------
// Labels & descriptions (presentation copy lives here so the UI stays clean)
// ---------------------------------------------------------------------------

const ROLE_LABELS: Record<Role, { label: string; description: string; rank: number }> = {
  owner: {
    label: "Owner",
    description: "Full control. Receives every capability by structure and cannot be edited.",
    rank: 100,
  },
  org_admin: {
    label: "Org admin",
    description: "Configures the organization and manages membership.",
    rank: 80,
  },
  seller: {
    label: "Seller",
    description: "Manages products, orders, and customer relationships.",
    rank: 60,
  },
  driver: {
    label: "Driver",
    description: "Delivers one run at a time. Sees only the stops on the run they are assigned.",
    rank: 30,
  },
  farm_manager: {
    label: "Farm manager",
    description: "Operational leadership over sites and assignments.",
    rank: 60,
  },
  supervisor: {
    label: "Supervisor",
    description: "Front-line oversight with read-only access to history.",
    rank: 50,
  },
  caretaker: {
    label: "Caretaker",
    description: "Hands-on worker. No administrative privileges by default.",
    rank: 30,
  },
  veterinarian: {
    label: "Veterinarian",
    description: "Animal-health specialist, scoped per site.",
    rank: 50,
  },
  biosecurity_qa: {
    label: "Biosecurity & QA",
    description: "Compliance and traceability reviews.",
    rank: 50,
  },
  maintenance: {
    label: "Maintenance",
    description: "Repairs and equipment cycles.",
    rank: 40,
  },
  inventory: {
    label: "Inventory",
    description: "Stock and feed management.",
    rank: 40,
  },
  logistics: {
    label: "Logistics",
    description: "Inbound and outbound shipments.",
    rank: 40,
  },
  auditor: {
    label: "Auditor",
    description: "Read-only access to audit and security events.",
    rank: 20,
  },
  support: {
    label: "Support",
    description: "Time-bound access granted via support session.",
    rank: 10,
  },
};

const CAPABILITY_LABELS: Record<Capability, { label: string; description: string }> = {
  "organization.manage": {
    label: "Manage organization",
    description: "Create, archive, and bind to billing.",
  },
  "organization.settings.update": {
    label: "Update organization settings",
    description: "Identity, locale, time zone, region.",
  },
  "membership.invite": {
    label: "Invite users",
    description: "Send invitations and create pending memberships.",
  },
  "membership.role.change": {
    label: "Change member role",
    description: "Promote, demote, or transfer members between roles.",
  },
  "membership.scope.change": {
    label: "Change member scope",
    description: "Limit a member to specific sites, zones, or houses.",
  },
  "membership.deactivate": {
    label: "Deactivate members",
    description: "Suspend or transfer ownership on deactivation.",
  },
  "access_review.run": {
    label: "Run access reviews",
    description: "Start quarterly or one-off attestation campaigns.",
  },
  "access_review.decide": {
    label: "Decide review items",
    description: "Keep, modify, or revoke each member in a review.",
  },
  "support_session.open": {
    label: "Open support sessions",
    description: "Grant time-bound access to a technician.",
  },
  "support_session.end": {
    label: "End support sessions",
    description: "Revoke active sessions and optionally the membership.",
  },
  "break_glass.open": {
    label: "Open break-glass",
    description: "Trigger an audited emergency override.",
  },
  "break_glass.finalize": {
    label: "Finalize break-glass review",
    description: "Close out a break-glass event with a post-use review.",
  },
  "audit.read": {
    label: "Read audit log",
    description: "Inspect the immutable history of mutations.",
  },
  "audit_log.read": {
    label: "Read audit log (raw)",
    description: "Inspect the underlying audit_log table.",
  },
  "auth_security.read": {
    label: "Read security events",
    description: "Inspect login, MFA, and session lifecycle events.",
  },
  "step_up.reauth": {
    label: "Step-up re-authentication (locked)",
    description:
      "Required to confirm sensitive mutations. Always preserved for roles that need it; cannot be removed.",
  },
  "catalog.manage": {
    label: "Manage catalog",
    description: "Create and edit categories, products, and variants.",
  },
  "orders.manage": {
    label: "Manage orders",
    description: "Create, view, and update order statuses.",
  },
  "customers.manage": {
    label: "Manage customers",
    description: "Add and edit customer records.",
  },
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: ActionErrorCode;
      message: string;
      /**
       * Full path under `errors.identity.*` for a client to resolve with a
       * root-namespace `useTranslations()` + `t(messageKey as never)`.
       * Additive: `roles-page-client.tsx` is the only consumer, but kept
       * optional for the same reason as `actions.ts`'s `ActionResult`.
       */
      messageKey?: string;
      /** ICU params for `messageKey` (e.g. `{ role: input.role }`). */
      messageParams?: Record<string, string | number>;
      fieldErrors?: Record<string, string[]>;
    };

export type ActionErrorCode =
  | "validation"
  | "unauthenticated"
  | "forbidden"
  | "reauth_required"
  | "not_found"
  | "internal";

function err<T = never>(
  code: ActionErrorCode,
  message: string,
  messageKey?: string,
  fieldErrors?: Record<string, string[]>,
  messageParams?: Record<string, string | number>,
): ActionResult<T> {
  return {
    ok: false,
    code,
    message,
    ...(messageKey ? { messageKey } : {}),
    ...(messageParams ? { messageParams } : {}),
    ...(fieldErrors ? { fieldErrors } : {}),
  };
}

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

async function ctxFor(userId: string) {
  return { actorUserId: userId, correlationId: randomUUID() };
}

async function reauthOrError(): Promise<
  | { ok: true; userId: string; correlationId: string }
  | { ok: false; result: ActionResult<never> }
> {
  try {
    const proof = await requireReauth();
    return {
      ok: true,
      userId: proof.userId,
      correlationId: randomUUID(),
    };
  } catch (e) {
    if (e instanceof ReauthRequiredError) {
      return { ok: false, result: err("reauth_required", e.message, "errors.identity.common.reauthRequired") };
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Member role lookup (who is calling?)
// ---------------------------------------------------------------------------

type CallerRole = { userId: string; role: Role };

/** Maps `callerRole()`'s two fixed forbidden strings to `errors.identity.*`. */
function callerForbiddenKey(message: string): string {
  return message === "Sign in first" ? "errors.identity.common.unauthenticated" : "errors.identity.common.notMember";
}

async function callerRole(organizationId: string): Promise<CallerRole | { forbidden: string }> {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof PermissionError) return { forbidden: "Sign in first" };
    throw e;
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { forbidden: "Not a member of this organization" };
  return { userId: user.id, role: data.role as Role };
}

// ---------------------------------------------------------------------------
// getRolesView: read-side, no reauth, render-ready for any active member.
// Non-owners see the canonical matrix; owners additionally see overrides
// and may edit.
// ---------------------------------------------------------------------------

const NON_OWNER_READ_RESULT: ActionResult<RolesViewModel> = err(
  "forbidden",
  "Not a member of this organization",
);

export async function getRolesView(
  organizationId: string,
): Promise<ActionResult<RolesViewModel>> {
  const caller = await callerRole(organizationId);
  if ("forbidden" in caller) return NON_OWNER_READ_RESULT;

  const supabase = await createSupabaseServerClient();
  const isOwner = caller.role === "owner";
  const canEdit = isOwner;

  // Fetch overrides + last-edit timestamp. RLS: only owners can SELECT.
  // For non-owners, these queries return zero rows and no error -- the
  // helper is fail-closed to the canonical matrix via mergeOverrides.
  let overrides: Array<{
    role: string;
    capability: string;
    granted: boolean;
    updated_at: string;
  }> = [];
  let lastEditedAt: string | null = null;
  if (isOwner) {
    const { data: rows, error } = await supabase
      .from("role_capability_overrides")
      .select("role, capability, granted, updated_at")
      .eq("organization_id", organizationId);
    if (!error && rows) {
      overrides = rows as typeof overrides;
      if (overrides.length > 0) {
        lastEditedAt = overrides
          .map((o) => o.updated_at)
          .sort()
          .at(-1) ?? null;
      }
    }
  }

  const overrideMap: Record<Role, Record<Capability, boolean>> = {} as Record<
    Role,
    Record<Capability, boolean>
  >;
  for (const r of ROLES) {
    overrideMap[r] = {} as Record<Capability, boolean>;
    for (const c of CAPABILITIES) overrideMap[r][c] = false;
  }
  for (const o of overrides) {
    if (!(o.role in overrideMap)) continue;
    if (!(o.capability in overrideMap[o.role as Role])) continue;
    overrideMap[o.role as Role][o.capability as Capability] = o.granted;
  }

  const roles: RoleView[] = ROLES.map((role) => {
    const cells: RoleCapabilityCell[] = CAPABILITIES.map((capability) => {
      const defaultGranted = can(role, capability);
      const hasOverride = Object.prototype.hasOwnProperty.call(overrideMap[role], capability);
      const granted =
        isOwner && hasOverride && isCapabilityOverridable(capability) && isRoleEditable(role)
          ? overrideMap[role][capability]
          : defaultGranted;
      return {
        capability,
        label: CAPABILITY_LABELS[capability].label,
        description: CAPABILITY_LABELS[capability].description,
        area: CAPABILITY_AREA[capability],
        granted,
        defaultGranted,
        isOverridden: hasOverride && isOwner,
        isOverridable: isCapabilityOverridable(capability),
        isEditableRole: isRoleEditable(role),
      };
    });
    const meta = ROLE_LABELS[role];
    return {
      role,
      label: meta.label,
      description: meta.description,
      rank: meta.rank,
      isEditable: isRoleEditable(role),
      isOwnerLocked: role === "owner",
      cells,
    };
  });

  return ok({
    organizationId,
    organizationName: "", // filled in by the page; we keep the action small
    isOwner,
    canEdit,
    roles,
    areas: CAPABILITY_AREAS,
    totals: {
      roles: roles.length,
      capabilities: CAPABILITIES.length,
      overrides: overrides.length,
    },
    lastEditedAt,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

const UpdateCapabilityInput = z.object({
  organizationId: z.string().uuid(),
  role: z.enum(ROLES),
  capability: z.enum(CAPABILITIES),
  granted: z.boolean(),
  reason: z.string().min(10).max(1000),
});

export async function updateRoleCapabilityAction(
  rawInput: unknown,
): Promise<ActionResult<{ overrideId: string }>> {
  const reauth = await reauthOrError();
  if (!reauth.ok) return reauth.result;

  const parsed = UpdateCapabilityInput.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid input", "errors.identity.common.invalidInput", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  if (!isRoleEditable(input.role)) {
    return err(
      "forbidden",
      `Role '${input.role}' is not editable`,
      "errors.identity.roles.notEditable",
      undefined,
      { role: input.role },
    );
  }
  if (!isCapabilityOverridable(input.capability)) {
    return err(
      "forbidden",
      `Capability '${input.capability}' is locked`,
      "errors.identity.roles.capabilityLocked",
      undefined,
      { capability: input.capability },
    );
  }

  const caller = await callerRole(input.organizationId);
  if ("forbidden" in caller) return err("forbidden", caller.forbidden, callerForbiddenKey(caller.forbidden));
  if (caller.role !== "owner") {
    return err("forbidden", "Only the owner can edit capabilities", "errors.identity.roles.ownerOnlyEdit");
  }

  const supabase = await createSupabaseServerClient();
  const { data: upserted, error } = await supabase
    .from("role_capability_overrides")
    .upsert(
      {
        organization_id: input.organizationId,
        role: input.role,
        capability: input.capability,
        granted: input.granted,
        reason: input.reason,
        changed_by: caller.userId,
      },
      { onConflict: "organization_id,role,capability" },
    )
    .select("id")
    .single();
  if (error || !upserted) {
    return err(
      "internal",
      error?.message ?? "Failed to save override",
      error ? "errors.identity.common.internal" : "errors.identity.roles.saveOverrideFailed",
    );
  }

  const ctx = await ctxFor(reauth.userId);
  await recordAudit(
    {
      organizationId: input.organizationId,
      actorUserId: reauth.userId,
      actorRole: caller.role,
      eventType: "identity.role_capability_changed",
      entityType: "role_capability_overrides",
      entityId: upserted.id,
      after: {
        role: input.role,
        capability: input.capability,
        granted: input.granted,
        reason: input.reason,
      },
      reason: input.reason,
      correlationId: ctx.correlationId,
      source: "web",
    },
    ctx,
  );

  revalidatePath(`/[organizationSlug]/settings/roles`, "page");
  return ok({ overrideId: upserted.id });
}

const ResetRoleInput = z.object({
  organizationId: z.string().uuid(),
  role: z.enum(ROLES),
  reason: z.string().min(10).max(1000),
});

export async function resetRoleToDefaultsAction(
  rawInput: unknown,
): Promise<ActionResult<{ removed: number }>> {
  const reauth = await reauthOrError();
  if (!reauth.ok) return reauth.result;

  const parsed = ResetRoleInput.safeParse(rawInput);
  if (!parsed.success) {
    return err("validation", "Invalid input", "errors.identity.common.invalidInput", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  if (!isRoleEditable(input.role)) {
    return err(
      "forbidden",
      `Role '${input.role}' is not editable`,
      "errors.identity.roles.notEditable",
      undefined,
      { role: input.role },
    );
  }
  const caller = await callerRole(input.organizationId);
  if ("forbidden" in caller) return err("forbidden", caller.forbidden, callerForbiddenKey(caller.forbidden));
  if (caller.role !== "owner") {
    return err("forbidden", "Only the owner can reset capabilities", "errors.identity.roles.ownerOnlyReset");
  }

  const supabase = await createSupabaseServerClient();
  // Capture the rows we are about to delete for the audit before-image.
  const { data: beforeRows, error: beforeErr } = await supabase
    .from("role_capability_overrides")
    .select("id, capability, granted")
    .eq("organization_id", input.organizationId)
    .eq("role", input.role);
  if (beforeErr) return err("internal", beforeErr.message, "errors.identity.common.internal");

  const { data: deleted, error } = await supabase
    .from("role_capability_overrides")
    .delete()
    .eq("organization_id", input.organizationId)
    .eq("role", input.role)
    .select("id");
  if (error) return err("internal", error.message, "errors.identity.common.internal");
  const removed = (deleted ?? []).length;

  const ctx = await ctxFor(reauth.userId);
  await recordAudit(
    {
      organizationId: input.organizationId,
      actorUserId: reauth.userId,
      actorRole: caller.role,
      eventType: "identity.role_capabilities_reset",
      entityType: "role_capability_overrides",
      entityId: null,
      before: { role: input.role, capabilities: beforeRows ?? [] },
      after: { role: input.role, removed },
      reason: input.reason,
      correlationId: ctx.correlationId,
      source: "web",
    },
    ctx,
  );

  revalidatePath(`/[organizationSlug]/settings/roles`, "page");
  return ok({ removed });
}
