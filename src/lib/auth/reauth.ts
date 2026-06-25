/**
 * Step-up re-auth cookie. Sensitive actions (`changeMemberRole`,
 * `openBreakGlass`, `deactivateUser`, `openSupportSession`,
 * `endSupportSession`) call `requireReauth()`; the cookie is set by
 * `POST /api/auth/reauth` after a successful password + TOTP challenge.
 *
 * The cookie is HMAC-signed with `REAUTH_COOKIE_SECRET` and short-lived
 * (default 5 minutes). Server Actions must re-verify; we never trust a
 * stale proof.
 */

import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { serverEnv } from "@/lib/env";

const COOKIE_NAME = "reauth_proof";
const ALG = "sha256";

type Proof = {
  userId: string;
  expiresAt: number; // ms epoch
  jti: string;
};

function sign(payload: string): string {
  const env = serverEnv();
  return createHmac(ALG, env.REAUTH_COOKIE_SECRET).update(payload).digest("base64url");
}

function verify(payload: string, signature: string): boolean {
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function setReauthCookie(userId: string): Promise<{ jti: string; expiresAt: Date }> {
  const env = serverEnv();
  const jti = crypto.randomUUID();
  const expiresAtMs = Date.now() + env.REAUTH_TTL_SECONDS * 1000;
  const payload: Proof = { userId, expiresAt: expiresAtMs, jti };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(encoded);

  const jar = await cookies();
  jar.set(COOKIE_NAME, `${encoded}.${signature}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: env.REAUTH_TTL_SECONDS,
  });

  return { jti, expiresAt: new Date(expiresAtMs) };
}

export async function readReauthProof(userId: string): Promise<Proof | null> {
  const raw = (await cookies()).get(COOKIE_NAME)?.value;
  if (!raw) return null;
  const [encoded, signature] = raw.split(".");
  if (!encoded || !signature) return null;
  if (!verify(encoded, signature)) return null;
  let payload: Proof;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Proof;
  } catch {
    return null;
  }
  if (payload.userId !== userId) return null;
  if (payload.expiresAt < Date.now()) return null;
  return payload;
}

export async function clearReauthCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_NAME, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
}
