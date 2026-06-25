/**
 * Channel registry. New channels register here so the dispatcher can
 * iterate them.
 */

import "server-only";

import { sendEmail } from "@/lib/email/resend";

export type Channel = "email" | "inapp";

export const channels: Record<Channel, (input: { to: string[]; subject: string; html: string }) => Promise<void>> = {
  email: sendEmail,
  inapp: async () => {
    // Wired in Phase 2 with the `notifications` table from MOD-06.
  },
};
