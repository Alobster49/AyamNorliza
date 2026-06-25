// supabase/functions/_shared/resend.ts
// Thin Resend wrapper for Edge Functions. Mirrors src/lib/email/resend.ts
// but uses Deno.fetch to avoid the npm `resend` SDK.

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "AyamNorliza Ops <no-reply@ayamnorliza.example>";

export async function sendEmail(input: {
  to: string[];
  subject: string;
  html: string;
}): Promise<void> {
  if (!RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not set; skipping email send");
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend error ${res.status}: ${body}`);
  }
}
