// supabase/functions/temporary-access-expiry/index.ts
// Scheduled Edge Function: scans temporary memberships and active
// break-glass events that are about to expire and sends a templated
// "expiring soon" email to the affected users. Runs daily at 09:00 MYT.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail } from "../_shared/resend.ts";
import { getMessages, interpolate } from "../_shared/messages.ts";
import { cronGuard } from "../_shared/cron-guard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve(async (req) => {
  const denied = cronGuard(req);
  if (denied) return denied;

  const horizon = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const messages = getMessages("en");
  let notified = 0;

  // 1. Memberships with `expires_at` in the next 48h.
  const { data: members, error: mErr } = await admin
    .from("organization_members")
    .select("id, organization_id, user_id, expires_at, organizations!inner(name)")
    .eq("status", "active")
    .not("expires_at", "is", null)
    .lte("expires_at", horizon);
  if (mErr) return new Response(JSON.stringify({ error: mErr.message }), { status: 500 });

  for (const m of members ?? []) {
    const { data: u } = await admin.auth.admin.getUserById(m.user_id);
    if (!u?.user?.email) continue;
    const org = (m as unknown as { organizations: { name: string } }).organizations;
    const values = { organizationName: org.name, expiresAt: m.expires_at };
    try {
      await sendEmail({
        to: [u.user.email],
        subject: interpolate(messages.temporaryAccessExpiring.subject, values),
        html: interpolate(messages.temporaryAccessExpiring.bodyHtml, values),
      });
      notified += 1;
    } catch (e) {
      console.error("sendEmail failed", e);
    }
  }

  // 2. Active break-glass events that are about to expire.
  const { data: glasses, error: gErr } = await admin
    .from("break_glass_events")
    .select("id, organization_id, user_id, expires_at, organizations!inner(name)")
    .is("ended_at", null)
    .gt("expires_at", new Date().toISOString())
    .lte("expires_at", horizon);
  if (gErr) return new Response(JSON.stringify({ error: gErr.message }), { status: 500 });

  for (const b of glasses ?? []) {
    const { data: u } = await admin.auth.admin.getUserById(b.user_id);
    if (!u?.user?.email) continue;
    const org = (b as unknown as { organizations: { name: string } }).organizations;
    const values = { organizationName: org.name, expiresAt: b.expires_at };
    try {
      await sendEmail({
        to: [u.user.email],
        subject: interpolate(messages.temporaryAccessExpiring.subject, values),
        html: interpolate(messages.temporaryAccessExpiring.bodyHtml, values),
      });
      notified += 1;
    } catch (e) {
      console.error("sendEmail failed", e);
    }
  }

  return new Response(
    JSON.stringify({ notified, memberships: members?.length ?? 0, break_glass: glasses?.length ?? 0 }),
    { status: 200 },
  );
});
