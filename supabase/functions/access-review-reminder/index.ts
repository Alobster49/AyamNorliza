// supabase/functions/access-review-reminder/index.ts
// Scheduled Edge Function: scans `access_reviews` and notifies reviewers
// of reviews that are due in the next 48 hours. Sends a templated
// email via Resend.
//
// Schedule (in `supabase/config.toml`): daily at 09:00 MYT.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail } from "../_shared/resend.ts";
import { getMessages, interpolate } from "../_shared/messages.ts";
import { cronGuard } from "../_shared/cron-guard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") ?? "http://localhost:3000";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve(async (req) => {
  const denied = cronGuard(req);
  if (denied) return denied;

  const cutoff = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const { data: reviews, error } = await admin
    .from("access_reviews")
    .select("id, organization_id, reviewer_id, due_at, status, organizations!inner(slug, name)")
    .in("status", ["open", "in_progress"])
    .lte("due_at", cutoff)
    .order("due_at", { ascending: true });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let notified = 0;
  for (const r of reviews ?? []) {
    const org = (r as unknown as { organizations: { slug: string; name: string } }).organizations;
    // Look up the reviewer's email via auth.admin.
    const { data: user } = await admin.auth.admin.getUserById(r.reviewer_id);
    if (!user?.user?.email) continue;
    const messages = getMessages("en");
    const subject = messages.invite.subject.replace("{organizationName}", org.name);
    const html = `
      <p>Hello,</p>
      <p>Access review <code>${r.id}</code> in <strong>${org.name}</strong> is due by ${r.due_at}.</p>
      <p><a href="${SITE_URL}/${org.slug}/settings/access-reviews">Open review</a></p>
    `;
    try {
      await sendEmail({ to: [user.user.email], subject, html });
      notified += 1;
    } catch (e) {
      console.error("sendEmail failed", e);
    }
  }
  // Silence unused-var warning for interpolate import (used elsewhere in
  // the lib; kept here so the file shape mirrors the app copy).
  void interpolate;
  return new Response(JSON.stringify({ notified }), { status: 200 });
});
