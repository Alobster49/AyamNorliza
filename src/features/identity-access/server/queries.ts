/**
 * Read queries used by Server Components. Always run under the caller's
 * RLS context (the per-request server Supabase client) - this file MUST
 * NOT use the admin client.
 */

import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import type {
  AccessReview,
  AccessReviewItem,
  AuditLogEntry,
  Invitation,
  MemberScope,
  Organization,
  OrganizationMember,
  OrganizationRole,
  Profile,
} from "../types";

export async function listOrganizationsForCurrentUser(): Promise<Organization[]> {
  await requireUserOrRedirect();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("organizations")
    .select(
      "id, slug, name, legal_name, region, default_time_zone, default_locale, status, created_at, updated_at, version",
    )
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToOrganization);
}

export async function getOrganizationBySlug(slug: string): Promise<Organization | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("organizations")
    .select(
      "id, slug, name, legal_name, region, default_time_zone, default_locale, status, created_at, updated_at, version",
    )
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToOrganization(data) : null;
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, display_name, locale, time_zone, contact_preferences, status, avatar")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data
    ? {
        userId: data.user_id,
        displayName: data.display_name,
        locale: data.locale,
        timeZone: data.time_zone,
        contactPreferences: (data.contact_preferences ?? {}) as Record<string, unknown>,
        status: data.status,
        avatar: data.avatar ?? null,
      }
    : null;
}

export async function listMembers(
  organizationId: string,
  opts: { role?: string; status?: string; q?: string } = {},
): Promise<OrganizationMember[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("organization_members")
    .select(
      "id, organization_id, user_id, role, role_id, status, starts_at, expires_at, invited_by, sponsor_id, client_operation_id",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (opts.role) query = query.eq("role", opts.role);
  if (opts.status) query = query.eq("status", opts.status);

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []).map(rowToMember);
  if (!opts.q) return rows;
  const q = opts.q.trim().toLowerCase();
  if (q.length === 0) return rows;
  // Substring filter against profiles.display_name joined client-side; avoids a DB join here.
  // For 0..500-member orgs this is cheap; revisit if perf becomes an issue.
  const userIds = Array.from(new Set(rows.map((r) => r.userId)));
  if (userIds.length === 0) return rows;
  const { data: profiles, error: pErr } = await supabase
    .from("profiles")
    .select("user_id, display_name, contact_preferences")
    .in("user_id", userIds);
  if (pErr) throw pErr;
  const matchingIds = new Set<string>();
  for (const p of profiles ?? []) {
    const display = (p.display_name ?? "").toLowerCase();
    if (display.includes(q)) matchingIds.add(p.user_id);
  }
  return rows.filter((r) => matchingIds.has(r.userId));
}

/**
 * Roles a picker may offer: every `organization_roles` row for this org,
 * optionally filtered to `rank <= maxRank` (a caller may only ever grant a
 * role at or below their own rank -- see `canGrantRole` in
 * `@/lib/auth/permissions`). Ordered by rank descending so pickers read
 * top-down the same way the rank ladder does.
 */
export async function listOrganizationRoles(
  organizationId: string,
  opts: { maxRank?: number } = {},
): Promise<OrganizationRole[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("organization_roles")
    .select("id, key, name, rank, is_system")
    .eq("organization_id", organizationId)
    .order("rank", { ascending: false });
  if (opts.maxRank !== undefined) query = query.lte("rank", opts.maxRank);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    rank: row.rank,
    isSystem: row.is_system,
  }));
}

export async function listProfilesByUserIds(
  userIds: string[],
): Promise<Map<string, string | null>> {
  if (userIds.length === 0) return new Map();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, display_name")
    .in("user_id", userIds);
  if (error) throw error;
  return new Map((data ?? []).map((p) => [p.user_id, p.display_name ?? null]));
}

export async function listMemberScopes(organizationId: string): Promise<MemberScope[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("member_scopes")
    .select(
      "id, organization_member_id, organization_id, site_id, zone_id, house_id, permission, starts_at, expires_at",
    )
    .eq("organization_id", organizationId);
  if (error) throw error;
  return (data ?? []).map(rowToScope);
}

export async function listInvitations(organizationId: string): Promise<Invitation[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("invitations")
    .select(
      "id, organization_id, email, role, proposed_scopes, expires_at, accepted_at, revoked_at, invited_by",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    role: row.role,
    proposedScopes: Array.isArray(row.proposed_scopes)
      ? (row.proposed_scopes as Invitation["proposedScopes"])
      : [],
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
    invitedBy: row.invited_by,
  }));
}

export async function listAccessReviews(organizationId: string): Promise<AccessReview[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("access_reviews")
    .select("id, organization_id, period_start, period_end, reviewer_id, status, due_at")
    .eq("organization_id", organizationId)
    .order("due_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    reviewerId: row.reviewer_id,
    status: row.status,
    dueAt: row.due_at,
  }));
}

export async function listAccessReviewItems(
  accessReviewId: string,
): Promise<AccessReviewItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("access_review_items")
    .select(
      "id, access_review_id, organization_member_id, decision, decision_reason, evidence, decided_at, decided_by",
    )
    .eq("access_review_id", accessReviewId);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    accessReviewId: row.access_review_id,
    organizationMemberId: row.organization_member_id,
    decision: row.decision,
    decisionReason: row.decision_reason,
    evidence: (row.evidence ?? {}) as Record<string, unknown>,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
  }));
}

export async function listAuditLog(input: {
  organizationId: string;
  from?: string;
  to?: string;
  eventType?: string;
  entityType?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: AuditLogEntry[]; total: number }> {
  const supabase = await createSupabaseServerClient();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);

  let query = supabase
    .from("audit_log")
    .select(
      "id, organization_id, actor_user_id, actor_role, event_type, entity_type, entity_id, before, after, reason, correlation_id, source, occurred_at",
      { count: "exact" },
    )
    .eq("organization_id", input.organizationId)
    .order("occurred_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (input.from) query = query.gte("occurred_at", input.from);
  if (input.to) query = query.lte("occurred_at", input.to);
  if (input.eventType) query = query.eq("event_type", input.eventType);
  if (input.entityType) query = query.eq("entity_type", input.entityType);

  const { data, error, count } = await query;
  if (error) throw error;
  return {
    rows: (data ?? []).map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      actorUserId: row.actor_user_id,
      actorRole: row.actor_role,
      eventType: row.event_type,
      entityType: row.entity_type,
      entityId: row.entity_id,
      before: row.before,
      after: row.after,
      reason: row.reason,
      correlationId: row.correlation_id,
      source: row.source,
      occurredAt: row.occurred_at,
    })),
    total: count ?? 0,
  };
}

function rowToOrganization(row: {
  id: string;
  slug: string;
  name: string;
  legal_name: string | null;
  region: string | null;
  default_time_zone: string;
  default_locale: string;
  status: "active" | "suspended" | "archived";
  created_at: string;
  updated_at: string;
  version: number;
}): Organization {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    legalName: row.legal_name,
    region: row.region,
    defaultTimeZone: row.default_time_zone,
    defaultLocale: row.default_locale,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function rowToMember(row: {
  id: string;
  organization_id: string;
  user_id: string;
  role: string;
  role_id: string;
  status: "invited" | "active" | "suspended" | "expired";
  starts_at: string;
  expires_at: string | null;
  invited_by: string | null;
  sponsor_id: string | null;
  client_operation_id: string | null;
}): OrganizationMember {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    role: row.role,
    roleId: row.role_id,
    status: row.status,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    invitedBy: row.invited_by,
    sponsorId: row.sponsor_id,
    clientOperationId: row.client_operation_id,
  };
}

function rowToScope(row: {
  id: string;
  organization_member_id: string;
  organization_id: string;
  site_id: string | null;
  zone_id: string | null;
  house_id: string | null;
  permission: string | null;
  starts_at: string;
  expires_at: string | null;
}): MemberScope {
  return {
    id: row.id,
    organizationMemberId: row.organization_member_id,
    organizationId: row.organization_id,
    siteId: row.site_id,
    zoneId: row.zone_id,
    houseId: row.house_id,
    permission: row.permission,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
  };
}
