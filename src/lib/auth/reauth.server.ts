/**
 * Step-up guard for sensitive Server Actions.
 *
 * Sensitive actions (`changeMemberRole`, `openBreakGlass`, `deactivateUser`,
 * `openSupportSession`, `endSupportSession`) call `requireReauth()`. If the
 * signed reauth cookie is missing or expired, the action throws a typed
 * `ReauthRequiredError` that the client surfaces to the `ReauthDialog`.
 */

import "server-only";

import { readReauthProof } from "./reauth";
import { requireUser } from "./require-user";

export class ReauthRequiredError extends Error {
  readonly code = "reauth_required";
  constructor(message = "Step-up re-authentication required") {
    super(message);
    this.name = "ReauthRequiredError";
  }
}

export async function requireReauth(ttlSeconds = 300): Promise<{ userId: string; jti: string }> {
  const user = await requireUser();
  const proof = await readReauthProof(user.id);
  if (!proof) throw new ReauthRequiredError();
  if (proof.expiresAt < Date.now() + ttlSeconds * 1000) {
    throw new ReauthRequiredError();
  }
  return { userId: proof.userId, jti: proof.jti };
}
