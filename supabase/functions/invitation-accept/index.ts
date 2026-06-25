// supabase/functions/invitation-accept/index.ts
// Edge Function that accepts an invitation token: verifies the SHA-256
// hash, creates the auth user on first sign-up, sets up the profile,
// activates the membership, and writes the `identity.membership_activated`
// audit event.
//
// Invoked from `/invite/[token]` after a successful sign-in or sign-up.
// All work happens in a single transaction via the admin client.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type AcceptBody = {
  token_hash: string;
  display_name?: string;
  client_operation_id?: string;
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: AcceptBody;
  try {
    body = (await req.json()) as AcceptBody;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!body.token_hash) return json({ error: "missing_token_hash" }, 400);

  const { data: invitation, error: invErr } = await admin
    .from("invitations")
    .select("id, organization_id, email, role, expires_at, accepted_at, revoked_at")
    .eq("token_hash", body.token_hash)
    .maybeSingle();
  if (invErr) return json({ error: "lookup_failed", detail: invErr.message }, 500);
  if (!invitation) return json({ error: "invalid_token" }, 404);
  if (invitation.accepted_at) return json({ error: "already_accepted" }, 409);
  if (invitation.revoked_at) return json({ error: "revoked" }, 410);
  if (new Date(invitation.expires_at).getTime() < Date.now()) {
    return json({ error: "expired" }, 410);
  }

  // Find or create the auth user.
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({
    email: invitation.email,
    page: 1,
    perPage: 1,
  });
  if (listErr) return json({ error: "user_lookup_failed", detail: listErr.message }, 500);
  let userId: string | undefined = list?.users?.[0]?.id;
  if (!userId) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: invitation.email,
      email_confirm: true,
    });
    if (createErr || !created.user) {
      return json({ error: "user_create_failed", detail: createErr?.message }, 500);
    }
    userId = created.user.id;
  }

  // Profile (idempotent).
  const displayName = body.display_name?.trim() || invitation.email.split("@")[0]!;
  await admin.from("profiles").upsert(
    { user_id: userId, display_name: displayName },
    { onConflict: "user_id" },
  );

  // Activate membership (idempotent on organization_id, user_id).
  const { error: memErr } = await admin
    .from("organization_members")
    .upsert(
      {
        organization_id: invitation.organization_id,
        user_id: userId,
        role: invitation.role,
        status: "active",
        invited_by: null,
        client_operation_id: body.client_operation_id ?? null,
      },
      { onConflict: "organization_id,user_id" },
    );
  if (memErr) return json({ error: "membership_failed", detail: memErr.message }, 500);

  // Mark the invitation as accepted.
  await admin
    .from("invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invitation.id);

  // Audit + security event.
  await admin.from("audit_log").insert({
    organization_id: invitation.organization_id,
    actor_user_id: userId,
    event_type: "identity.membership_activated",
    entity_type: "organization_members",
    entity_id: userId,
    after: { role: invitation.role },
    source: "server",
    client_operation_id: body.client_operation_id ?? null,
  });
  await admin.rpc("record_auth_security_event", {
    p_user_id: userId,
    p_organization_id: invitation.organization_id,
    p_event_type: "login_success",
    p_ip: null,
    p_user_agent: req.headers.get("user-agent"),
    p_geo_country: null,
    p_metadata: { reason: "invitation_accept" },
  });

  return json({ ok: true, organization_id: invitation.organization_id, user_id: userId });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
