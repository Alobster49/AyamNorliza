/**
 * Centralised, validated access to server-only environment variables.
 *
 * Rules:
 *   - Anything in `NEXT_PUBLIC_*` is safe to read on the client (use
 *     `env.public.ts` instead).
 *   - This module imports `server-only` so accidental client imports
 *     fail at build time.
 *   - Throwing on missing required values fails fast at boot.
 */

import "server-only";

export type ServerEnv = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_DB_URL: string;
  RESEND_API_KEY: string;
  EMAIL_FROM: string;
  INVITE_BASE_URL: string;
  SITE_URL: string;
  TOTP_ISSUER: string;
  SESSION_REFRESH_INTERVAL_SECONDS: number;
  BREAK_GLASS_MAX_MINUTES: number;
  REAUTH_COOKIE_SECRET: string;
  REAUTH_TTL_SECONDS: number;
};

let cached: ServerEnv | null = null;

function required(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  cached = {
    SUPABASE_URL: required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", undefined),
    SUPABASE_SERVICE_ROLE_KEY: required(
      "SUPABASE_SERVICE_ROLE_KEY",
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
    SUPABASE_DB_URL: required("SUPABASE_DB_URL", process.env.SUPABASE_DB_URL),
    RESEND_API_KEY: required("RESEND_API_KEY", process.env.RESEND_API_KEY),
    EMAIL_FROM: required("EMAIL_FROM", process.env.EMAIL_FROM),
    INVITE_BASE_URL: required("INVITE_BASE_URL", process.env.INVITE_BASE_URL),
    SITE_URL: required("SITE_URL", process.env.SITE_URL),
    TOTP_ISSUER: required("TOTP_ISSUER", process.env.TOTP_ISSUER),
    SESSION_REFRESH_INTERVAL_SECONDS: Number(
      process.env.SESSION_REFRESH_INTERVAL_SECONDS ?? 300,
    ),
    BREAK_GLASS_MAX_MINUTES: Number(process.env.BREAK_GLASS_MAX_MINUTES ?? 60),
    REAUTH_COOKIE_SECRET: required(
      "REAUTH_COOKIE_SECRET",
      process.env.REAUTH_COOKIE_SECRET,
    ),
    REAUTH_TTL_SECONDS: 300,
  };
  if (cached.REAUTH_COOKIE_SECRET.length < 32) {
    throw new Error("REAUTH_COOKIE_SECRET must be at least 32 bytes");
  }
  return cached;
}
