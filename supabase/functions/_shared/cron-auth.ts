// supabase/functions/_shared/cron-auth.ts
// Shared-secret gate for the pg_cron-invoked Edge Functions.
//
// access-review-reminder, temporary-access-expiry and market-price-sync are
// declared `verify_jwt = false` in config.toml, because pg_cron invokes them
// server-to-server rather than on behalf of a signed-in user. That left them
// callable by anyone who knew or guessed the function URL -- each one holds a
// service-role client, and between them they send real email to real org
// members and drive the KPDN ingest. Nothing rate-limits either.
//
// So they authenticate the caller themselves: pg_cron sends `x-cron-secret`
// (see 20260901000008_cron_shared_secret.sql, which reads it from the
// `app.cron_secret` database setting) and each function compares it against
// its own `CRON_SECRET` env var.
//
// invitation-accept deliberately does NOT use this: it is a genuinely public
// endpoint authenticated by the single-use invite token in its body.

/**
 * Whether a request may run a scheduled function.
 *
 * Fails closed when `expected` is missing or empty: an unconfigured secret
 * must never read as "allow everyone", which is the exact hole this guard
 * exists to close. The comparison is constant-time over the encoded bytes so
 * a caller cannot recover the secret byte by byte from response timing.
 */
export function isAuthorizedCron(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!expected) return false;
  if (!provided) return false;

  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
