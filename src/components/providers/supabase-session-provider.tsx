"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Session } from "@supabase/supabase-js";

/**
 * Client-side session provider. The actual session is refreshed
 * server-side by `proxy.ts`; this provider exposes the session to
 * client components for realtime and conditional rendering.
 */
export function SupabaseSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <div data-session-ready={ready ? "1" : "0"} data-user-id={session?.user.id ?? ""}>
      {children}
    </div>
  );
}
