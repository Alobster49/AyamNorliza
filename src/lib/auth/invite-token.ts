/**
 * Invitation token utilities.
 *
 * Tokens are 32 random bytes (base64url). We store SHA-256 of the token
 * (`token_hash`) on the `invitations` row so the raw value is never
 * persisted. The clear token is only ever placed in the email link.
 */

import "server-only";

import { createHash, randomBytes } from "node:crypto";

export type InvitationToken = { raw: string; hash: string };

export function newInvitationToken(): InvitationToken {
  const raw = randomBytes(32).toString("base64url");
  const hash = hashToken(raw);
  return { raw, hash };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("base64url");
}

export function verifyToken(raw: string, expectedHash: string): boolean {
  return hashToken(raw) === expectedHash;
}
