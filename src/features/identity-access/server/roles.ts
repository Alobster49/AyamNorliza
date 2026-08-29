/**
 * Server Actions for the Roles & Permissions settings page, backed by the
 * dynamic-RBAC schema (`organization_roles` / `role_permissions` — see
 * supabase/migrations/20260901000001_dynamic_rbac_schema.sql). Replaces the
 * MOD-19 stub, which modeled roles as a fixed enum with per-org capability
 * overrides; that stub (and its only consumer, `roles-page-client.tsx`) is
 * retired here since Task 11 (the roles editor UI) rebuilds the page against
 * this module from scratch.
 *
 * Every mutation:
 *   1. Zod-parses the input
 *   2. Gates on `requirePermission(slug, 'roles', 'edit')`
 *   3. Re-validates the DB-trigger rules in TS so callers get a clean
 *      `messageKey` instead of a raw Postgres exception (the triggers in
 *      20260901000001/3 back these up, they are not the primary defense):
 *        - the `owner` role's grants/name/existence can never be edited
 *        - system roles (`is_system`) can't be renamed or deleted, but
 *          their grants can be edited
 *        - a role can't be deleted while it still has active members
 *        - every `roleId` is validated to belong to the caller's org
 *   4. Writes via Supabase (RLS is the final backstop: `roles_write_editor`
 *      requires `has_permission(org, 'roles', 'edit')`)
 *   5. `revalidatePath`s the roles settings page
 *
 * `getRolesView` is read-only, gated on `('roles','view')`, and returns a
 * plain `RolesView` object (not an `ActionResult`) — same convention as
 * `resolvePermissionsForOrg`: it throws the `requirePermission` guard's
 * `OrderPermissionError` on denial rather than encoding failure in the
 * return type, since it's meant to be awaited directly by a page/loader.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { OrderPermissionError } from "@/features/orders/server/guards";
import {
  PAGE_ACTIONS,
  DEFAULT_ROLE_GRANTS,
  grantKey,
  type PermissionAction,
  type PermissionKey,
  type SystemRoleKey,
} from "@/lib/auth/rbac";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RoleRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  rank: number;
  isSystem: boolean;
  memberCount: number;
};

export type RolesView = {
  roles: RoleRow[];
  /** Keyed by roleId; lists every `granted = true` permission as a `PermissionKey`. */
  grants: Record<string, PermissionKey[]>;
  canEdit: boolean;
  actorRank: number;
};

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: ActionErrorCode;
      message: string;
      messageKey?: string;
      messageParams?: Record<string, string | number>;
      fieldErrors?: Record<string, string[]>;
    };

export type ActionErrorCode =
  | "validation"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
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

function permissionMessageKey(message: string): string {
  if (message === "Not authenticated") return "errors.identity.common.unauthenticated";
  if (message === "Organization not found") return "errors.identity.common.orgNotFound";
  return "errors.identity.roles.forbidden";
}

type RoleContext = { orgId: string; userId: string; roleId: string; roleKey: string };

async function guardEdit(
  organizationSlug: string,
): Promise<{ ok: true; ctx: RoleContext } | { ok: false; result: ActionResult<never> }> {
  try {
    const ctx = await requirePermission(organizationSlug, "roles", "edit");
    return { ok: true, ctx };
  } catch (e) {
    if (e instanceof OrderPermissionError) {
      return { ok: false, result: err("forbidden", e.message, permissionMessageKey(e.message)) };
    }
    throw e;
  }
}

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type OrgRoleRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  rank: number;
  is_system: boolean;
};

/**
 * Validates that `roleId` names a real role of `organizationId`, returning
 * `null` for both "doesn't exist" and "belongs to a different org" — every
 * caller treats cross-org roleIds the same as not-found.
 */
async function fetchRole(
  supabase: SupabaseClient,
  organizationId: string,
  roleId: string,
): Promise<OrgRoleRow | null> {
  const { data } = await supabase
    .from("organization_roles")
    .select("id, key, name, description, rank, is_system")
    .eq("id", roleId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return (data as OrgRoleRow | null) ?? null;
}

// ---------------------------------------------------------------------------
// getRolesView
// ---------------------------------------------------------------------------

export async function getRolesView(organizationSlug: string): Promise<RolesView> {
  const ctx = await requirePermission(organizationSlug, "roles", "view");

  let canEdit = true;
  try {
    await requirePermission(organizationSlug, "roles", "edit");
  } catch (e) {
    if (e instanceof OrderPermissionError) {
      canEdit = false;
    } else {
      throw e;
    }
  }

  const supabase = await createSupabaseServerClient();

  const { data: roleRows } = await supabase
    .from("organization_roles")
    .select("id, key, name, description, rank, is_system")
    .eq("organization_id", ctx.orgId)
    .order("rank", { ascending: false });
  const roles = (roleRows as OrgRoleRow[] | null) ?? [];

  const { data: memberRows } = await supabase
    .from("organization_members")
    .select("role_id")
    .eq("organization_id", ctx.orgId)
    .eq("status", "active");
  const counts = new Map<string, number>();
  for (const row of (memberRows as Array<{ role_id: string }> | null) ?? []) {
    counts.set(row.role_id, (counts.get(row.role_id) ?? 0) + 1);
  }

  const roleIds = roles.map((r) => r.id);
  const { data: grantRows } = await supabase
    .from("role_permissions")
    .select("role_id, resource, action, granted")
    .in("role_id", roleIds);
  const grants: Record<string, PermissionKey[]> = {};
  for (const role of roles) grants[role.id] = [];
  for (const g of (grantRows as
    | Array<{ role_id: string; resource: string; action: string; granted: boolean }>
    | null) ?? []) {
    if (!g.granted) continue;
    (grants[g.role_id] ??= []).push(grantKey(g.resource, g.action as PermissionAction));
  }

  const actorRole = roles.find((r) => r.id === ctx.roleId);

  return {
    roles: roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description ?? null,
      rank: r.rank,
      isSystem: r.is_system,
      memberCount: counts.get(r.id) ?? 0,
    })),
    grants,
    canEdit,
    actorRank: actorRole?.rank ?? 0,
  };
}

// ---------------------------------------------------------------------------
// createRoleAction
// ---------------------------------------------------------------------------

const CreateRoleInput = z.object({
  organizationSlug: z.string().min(1),
  name: z.string().trim().min(1),
  cloneFromRoleId: z.string().uuid().optional(),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createRoleAction(rawInput: unknown): Promise<ActionResult<{ roleId: string }>> {
  const parsed = CreateRoleInput.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      "validation",
      "Invalid input",
      "errors.identity.common.invalidInput",
      parsed.error.flatten().fieldErrors,
    );
  }
  const input = parsed.data;

  const guard = await guardEdit(input.organizationSlug);
  if (!guard.ok) return guard.result;
  const { ctx } = guard;

  const key = slugify(input.name);
  if (!key) {
    return err(
      "validation",
      "Name must contain at least one letter or number",
      "errors.identity.roles.invalidName",
      { name: ["errors.identity.roles.invalidName"] },
    );
  }

  const supabase = await createSupabaseServerClient();

  const { data: actorRoleRow } = await supabase
    .from("organization_roles")
    .select("rank")
    .eq("id", ctx.roleId)
    .maybeSingle();
  const actorRank = (actorRoleRow as { rank: number } | null)?.rank ?? 0;
  const rank = Math.max(1, Math.min(actorRank - 1, 10));

  let cloneGrants: Array<{ resource: string; action: string }> = [];
  if (input.cloneFromRoleId) {
    const cloneRole = await fetchRole(supabase, ctx.orgId, input.cloneFromRoleId);
    if (!cloneRole) {
      return err("not_found", "Role to clone from was not found", "errors.identity.roles.cloneSourceNotFound");
    }
    const { data: grantRows } = await supabase
      .from("role_permissions")
      .select("resource, action, granted")
      .eq("role_id", input.cloneFromRoleId)
      .eq("granted", true);
    cloneGrants = (grantRows as Array<{ resource: string; action: string; granted: boolean }> | null) ?? [];
  }

  const { data: created, error } = await supabase
    .from("organization_roles")
    .insert({ organization_id: ctx.orgId, key, name: input.name, rank, is_system: false })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      return err(
        "conflict",
        `A role with key '${key}' already exists`,
        "errors.identity.roles.duplicateKey",
        undefined,
        { key },
      );
    }
    return err("internal", error.message, "errors.identity.roles.createFailed");
  }
  if (!created) {
    return err("internal", "Failed to create role", "errors.identity.roles.createFailed");
  }
  const createdRow = created as { id: string };

  if (cloneGrants.length > 0) {
    const rows = cloneGrants.map((g) => ({
      role_id: createdRow.id,
      resource: g.resource,
      action: g.action,
      granted: true,
    }));
    const { error: grantError } = await supabase
      .from("role_permissions")
      .upsert(rows, { onConflict: "role_id,resource,action" });
    if (grantError) return err("internal", grantError.message, "errors.identity.common.internal");
  }

  revalidatePath("/[organizationSlug]/settings/roles", "page");
  return ok({ roleId: createdRow.id });
}

// ---------------------------------------------------------------------------
// renameRoleAction
// ---------------------------------------------------------------------------

const RenameRoleInput = z.object({
  organizationSlug: z.string().min(1),
  roleId: z.string().uuid(),
  name: z.string().trim().min(1),
  description: z.string().optional(),
});

export async function renameRoleAction(rawInput: unknown): Promise<ActionResult<void>> {
  const parsed = RenameRoleInput.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      "validation",
      "Invalid input",
      "errors.identity.common.invalidInput",
      parsed.error.flatten().fieldErrors,
    );
  }
  const input = parsed.data;

  const guard = await guardEdit(input.organizationSlug);
  if (!guard.ok) return guard.result;
  const { ctx } = guard;

  const supabase = await createSupabaseServerClient();
  const role = await fetchRole(supabase, ctx.orgId, input.roleId);
  if (!role) return err("not_found", "Role not found", "errors.identity.roles.notFound");
  if (role.key === "owner") {
    return err("forbidden", "The owner role cannot be renamed", "errors.identity.roles.ownerLocked");
  }
  if (role.is_system) {
    return err("forbidden", "System roles cannot be renamed", "errors.identity.roles.systemLocked");
  }

  const patch: { name: string; description?: string } = { name: input.name };
  if (input.description !== undefined) patch.description = input.description;

  const { error } = await supabase.from("organization_roles").update(patch).eq("id", input.roleId);
  if (error) return err("internal", error.message, "errors.identity.common.internal");

  revalidatePath("/[organizationSlug]/settings/roles", "page");
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// deleteRoleAction
// ---------------------------------------------------------------------------

const DeleteRoleInput = z.object({
  organizationSlug: z.string().min(1),
  roleId: z.string().uuid(),
});

export async function deleteRoleAction(rawInput: unknown): Promise<ActionResult<void>> {
  const parsed = DeleteRoleInput.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      "validation",
      "Invalid input",
      "errors.identity.common.invalidInput",
      parsed.error.flatten().fieldErrors,
    );
  }
  const input = parsed.data;

  const guard = await guardEdit(input.organizationSlug);
  if (!guard.ok) return guard.result;
  const { ctx } = guard;

  const supabase = await createSupabaseServerClient();
  const role = await fetchRole(supabase, ctx.orgId, input.roleId);
  if (!role) return err("not_found", "Role not found", "errors.identity.roles.notFound");
  if (role.key === "owner") {
    return err("forbidden", "The owner role cannot be deleted", "errors.identity.roles.ownerLocked");
  }
  if (role.is_system) {
    return err("forbidden", "System roles cannot be deleted", "errors.identity.roles.systemLocked");
  }

  const { data: memberRows } = await supabase
    .from("organization_members")
    .select("id")
    .eq("role_id", input.roleId)
    .eq("status", "active");
  if (((memberRows as Array<{ id: string }> | null) ?? []).length > 0) {
    return err(
      "conflict",
      "This role still has active members and cannot be deleted",
      "errors.identity.roles.hasMembers",
    );
  }

  const { error } = await supabase.from("organization_roles").delete().eq("id", input.roleId);
  if (error) return err("internal", error.message, "errors.identity.common.internal");

  revalidatePath("/[organizationSlug]/settings/roles", "page");
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// setPermissionAction
// ---------------------------------------------------------------------------

const SetPermissionInput = z.object({
  organizationSlug: z.string().min(1),
  roleId: z.string().uuid(),
  resource: z.string().min(1),
  action: z.enum([...PAGE_ACTIONS, "use"]),
  granted: z.boolean(),
});

/**
 * Expands a single (resource, action, granted) toggle into the full set of
 * `role_permissions` rows to upsert, applying the cascade rules: revoking
 * `view` also revokes `add`/`edit`/`delete` for that resource; granting
 * `add`/`edit`/`delete` auto-grants `view`. Admin capabilities (`action ===
 * "use"`) are standalone and never cascade.
 */
function permissionRows(
  roleId: string,
  resource: string,
  action: PermissionAction,
  granted: boolean,
): Array<{ role_id: string; resource: string; action: PermissionAction; granted: boolean }> {
  if (action === "use") {
    return [{ role_id: roleId, resource, action, granted }];
  }
  if (action === "view" && !granted) {
    return PAGE_ACTIONS.map((a) => ({ role_id: roleId, resource, action: a, granted: false }));
  }
  if (action !== "view" && granted) {
    return [
      { role_id: roleId, resource, action: "view", granted: true },
      { role_id: roleId, resource, action, granted: true },
    ];
  }
  return [{ role_id: roleId, resource, action, granted }];
}

export async function setPermissionAction(rawInput: unknown): Promise<ActionResult<void>> {
  const parsed = SetPermissionInput.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      "validation",
      "Invalid input",
      "errors.identity.common.invalidInput",
      parsed.error.flatten().fieldErrors,
    );
  }
  const input = parsed.data;

  const guard = await guardEdit(input.organizationSlug);
  if (!guard.ok) return guard.result;
  const { ctx } = guard;

  const supabase = await createSupabaseServerClient();
  const role = await fetchRole(supabase, ctx.orgId, input.roleId);
  if (!role) return err("not_found", "Role not found", "errors.identity.roles.notFound");
  if (role.key === "owner") {
    return err("forbidden", "The owner role's permissions are locked", "errors.identity.roles.ownerLocked");
  }

  const rows = permissionRows(input.roleId, input.resource, input.action, input.granted);
  const { error } = await supabase
    .from("role_permissions")
    .upsert(rows, { onConflict: "role_id,resource,action" });
  if (error) return err("internal", error.message, "errors.identity.common.internal");

  revalidatePath("/[organizationSlug]/settings/roles", "page");
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// resetRoleToDefaultsAction
// ---------------------------------------------------------------------------

const ResetRoleInput = z.object({
  organizationSlug: z.string().min(1),
  roleId: z.string().uuid(),
});

export async function resetRoleToDefaultsAction(rawInput: unknown): Promise<ActionResult<void>> {
  const parsed = ResetRoleInput.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      "validation",
      "Invalid input",
      "errors.identity.common.invalidInput",
      parsed.error.flatten().fieldErrors,
    );
  }
  const input = parsed.data;

  const guard = await guardEdit(input.organizationSlug);
  if (!guard.ok) return guard.result;
  const { ctx } = guard;

  const supabase = await createSupabaseServerClient();
  const role = await fetchRole(supabase, ctx.orgId, input.roleId);
  if (!role) return err("not_found", "Role not found", "errors.identity.roles.notFound");
  if (role.key === "owner") {
    return err("forbidden", "The owner role's permissions are locked", "errors.identity.roles.ownerLocked");
  }
  if (!role.is_system) {
    return err(
      "validation",
      "Custom roles have no default permissions to reset to",
      "errors.identity.roles.noDefaults",
    );
  }

  const defaults = DEFAULT_ROLE_GRANTS[role.key as SystemRoleKey];
  if (!defaults) return err("internal", "Unknown system role", "errors.identity.common.internal");

  const { error: deleteError } = await supabase.from("role_permissions").delete().eq("role_id", input.roleId);
  if (deleteError) return err("internal", deleteError.message, "errors.identity.common.internal");

  const rows = Array.from(defaults).map((pk) => {
    const idx = pk.lastIndexOf(":");
    return {
      role_id: input.roleId,
      resource: pk.slice(0, idx),
      action: pk.slice(idx + 1) as PermissionAction,
      granted: true,
    };
  });
  if (rows.length > 0) {
    const { error: insertError } = await supabase.from("role_permissions").insert(rows);
    if (insertError) return err("internal", insertError.message, "errors.identity.common.internal");
  }

  revalidatePath("/[organizationSlug]/settings/roles", "page");
  return ok(undefined);
}
