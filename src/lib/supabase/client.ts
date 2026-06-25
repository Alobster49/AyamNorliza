/**
 * Browser Supabase client.
 *
 * Used by Client Components for: auth state in the browser, narrow Realtime
 * subscriptions, and direct private Storage uploads under policy.
 *
 * Session is persisted in localStorage by @supabase/ssr.
 */

"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env.public";

export function createSupabaseBrowserClient() {
  const env = publicEnv();
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
