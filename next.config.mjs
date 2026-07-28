/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: false,
  // Allow HMR and other dev resources when accessing the dev server over the
  // LAN. Without this, browsers on a different host (e.g. http://192.168.x.x:3000)
  // see a partially-hydrated page where React event handlers never attach and
  // native form submission takes over, leaking credentials into query strings.
  allowedDevOrigins: ["192.168.50.100", "192.168.50.*", "localhost", "127.0.0.1"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        // Hosted Supabase Storage public URLs
        protocol: "https",
        hostname: "**.supabase.co",
      },
      {
        // Local Supabase (supabase start) storage URLs
        protocol: "http",
        hostname: "127.0.0.1",
      },
      {
        protocol: "http",
        hostname: "localhost",
      },
    ],
  },
  // Whitelist which env vars are exposed to the browser. Anything else must
  // stay server-only; see `src/lib/env.ts` and the SECURITY section of
  // the MOD-01 plan.
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self)' },
        ],
      },
    ];
  },
};

export default nextConfig;
