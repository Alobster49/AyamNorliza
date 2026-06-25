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
  Profile,
  SupportSession,
} from "../types";

export async function listOrganizationsForCurrentUser(): Promise<Organization[]> {
  await requireUserOrRedirect();
  const supabase = createSupabaseServerClient();
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
  const supabase = createSupabaseServerClient();
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
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, display_name, locale, time_zone, contact_preferences, status")
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
      }
    : null;
}

export async function listMembers(organizationId: string): Promise<OrganizationMember[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("organization_members")
    .select(
      "id, organization_id, user_id, role, status, starts_at, expires_at, invited_by, sponsor_id, client_operation_id",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToMember);
}

export async function listMemberScopes(organizationId: string): Promise<MemberScope[]> {
  const supabase = createSupabaseServerClient();
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
  const supabase = createSupabaseServerClient();
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
  const supabase = createSupabaseServerClient();
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
  const supabase = createSupabaseServerClient();
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

export async function listSupportSessions(
  organizationId: string,
): Promise<SupportSession[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("support_sessions")
    .select(
      "id, organization_id, sponsor_id, technician_id, purpose, permitted_scopes, starts_at, ends_at, recording_reference, status",
    )
    .eq("organization_id", organizationId)
    .order("starts_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    sponsorId: row.sponsor_id,
    technicianId: row.technician_id,
    purpose: row.purpose,
    permittedScopes: Array.isArray(row.permitted_scopes)
      ? (row.permitted_scopes as SupportSession["permittedScopes"])
      : [],
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    recordingReference: row.recording_reference,
    status: row.status,
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
  const supabase = createSupabaseServerClient();
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
