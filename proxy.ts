/**
 * Session-refresh proxy/middleware for Next.js App Router.
 *
 * Responsibilities:
 *   - Refresh the Supabase auth session on every navigation that touches a
 *     protected route. This keeps the access token fresh without depending
 *     on Server Components to write cookies.
 *   - Redirect unauthenticated users from `/(dashboard)/*` to `/login`,
 *     preserving the original URL in `?next=`.
 *   - Allow public auth routes (`/login`, `/signup`, `/mfa`, `/invite/*`,
 *     `/auth/*`).
 *
 * Important: this is a NAVIGATION guard only. Authorization (per-action
 * permission, RLS, re-auth step-up) is enforced inside Server Actions and
 * Route Handlers per the foundation and shared security docs.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export const config = {
  matcher: [
    // Run on every path except Next.js internals and static files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/mfa",
  "/invite",
  "/auth",
  "/favicon.ico",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request: { headers: request.headers } });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    // Misconfiguration: fail closed on the dashboard.
    if (!isPublic(request.nextUrl.pathname)) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      return NextResponse.redirect(loginUrl);
    }
    return response;
  }

  const supabase = createServerClient(url, anon, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        response.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        response.cookies.set({ name, value: "", ...options });
      },
    },
  });

  // Refresh the session; this also tells us whether the user is signed in.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isDashboard = pathname.startsWith("/(dashboard)") || pathname.startsWith("/settings");

  if (!user && !isPublic(pathname) && isDashboard) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
