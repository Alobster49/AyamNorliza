/**
 * Break-glass access. The DB stores the row; this module exposes typed
 * helpers used by Server Actions and Edge Functions.
 *
 * Break-glass grants elevated capability for a short, capped window
 * (default 30 minutes, max 60). The owner is notified within 60 seconds
 * and must finalise a post-use review.
 */

import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { admin, type AdminContext } from "@/lib/supabase/admin";

export type BreakGlassEvent = {
  id: string;
  organization_id: string;
  user_id: string;
  reason: string;
  ticket_reference: string | null;
  approved_by: string | null;
  starts_at: string;
  expires_at: string;
  ended_at: string | null;
  post_use_review: Record<string, unknown>;
};

export async function isBreakGlassActive(
  organizationId: string,
): Promise<{ active: boolean; expiresAt: string | null }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { active: false, expiresAt: null };
  const { data } = await supabase
    .from("break_glass_events")
    .select("expires_at")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .is("ended_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return { active: false, expiresAt: null };
  return { active: true, expiresAt: data.expires_at };
}

export async function listActive(organizationId: string): Promise<BreakGlassEvent[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("break_glass_events")
    .select(
      "id, organization_id, user_id, reason, ticket_reference, approved_by, starts_at, expires_at, ended_at, post_use_review",
    )
    .eq("organization_id", organizationId)
    .is("ended_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("starts_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as BreakGlassEvent[];
}

export async function recordPostUseReview(
  eventId: string,
  review: Record<string, unknown>,
  ctx: AdminContext,
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("break_glass_events")
    .update({ post_use_review: review })
    .eq("id", eventId)
    .select()
    .single();
  if (error) throw error;
  await admin.insertAuditEvent(
    {
      organizationId: data.organization_id,
      actorUserId: ctx.actorUserId,
      actorRole: null,
      actorSessionId: null,
      eventType: "identity.break_glass_review_finalized",
      entityType: "break_glass_events",
      entityId: data.id,
      before: null,
      after: { post_use_review: review },
      reason: null,
      correlationId: ctx.correlationId,
      clientOperationId: null,
      source: "web",
    },
    ctx,
  );
}
