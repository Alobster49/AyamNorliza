/**
 * Resend wrapper.
 *
 * - Never logs the API key.
 * - Never logs PII beyond the recipient address (needed for delivery).
 * - Re-throws typed errors so callers can record delivery status.
 */

import "server-only";

import { Resend } from "resend";
import { serverEnv } from "@/lib/env";

let cachedClient: Resend | null = null;

function client(): Resend {
  if (cachedClient) return cachedClient;
  const env = serverEnv();
  cachedClient = new Resend(env.RESEND_API_KEY);
  return cachedClient;
}

export async function sendEmail(input: {
  to: string[];
  subject: string;
  html: string;
}): Promise<void> {
  const env = serverEnv();
  const result = await client().emails.send({
    from: env.EMAIL_FROM,
    to: input.to,
    subject: input.subject,
    html: input.html,
  });
  if (result.error) {
    throw new Error(`Resend error: ${result.error.name}: ${result.error.message}`);
  }
}
