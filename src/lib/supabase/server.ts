/**
 * Per-request server Supabase client.
 *
 * Uses the cookie-aware adapter from @supabase/ssr so the user's session
 * (access + refresh tokens) is forwarded on every Server Component,
 * Server Action, and Route Handler call. All queries run under RLS as
 * the current user.
 *
 * Must NEVER be imported from a Client Component. Marked `server-only`.
 */

import "server-only";

import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { serverEnv } from "@/lib/env";

export function createSupabaseServerClient() {
  const env = serverEnv();
  const cookieStore = cookies();

  return createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // Server Components cannot set cookies; the proxy/middleware
          // is responsible for refreshing the session. Ignore.
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: "", ...options });
        } catch {
          // Same as set(): ignore in Server Components.
        }
      },
    },
  });
}
