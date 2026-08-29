import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { createSupabaseServerClient as createClient } from "@/lib/supabase/server";
import {
  getOrganizationBySlug,
  getProfile,
} from "@/features/identity-access/server/queries";
import { SupabaseSessionProvider } from "@/components/providers/supabase-session-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/features/dashboard/components/app-sidebar";
import { DashboardShellHeader } from "@/features/dashboard/components/dashboard-shell-header";

export default async function SellerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const user = await requireUserOrRedirect(`/${organizationSlug}`, { requireAal2: true });

  // Check the caller is an active member of this org at all.
  const supabase = await createClient();
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();

  const { data: member } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", org.id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .single();

  // Any active org member may open this shell — the sidebar (AppSidebar /
  // dashboard-shell-model.ts) narrows the nav per role, and per-page
  // `requireOrgRole` guards are the real security boundary: a role that
  // shouldn't see a given page gets redirected there, not here. This layout
  // only rejects users who aren't an active member of the org at all.
  if (!member) {
    // Locale-prefixed explicitly (same pattern as requireUserOrRedirect):
    // a bare path bounces through the middleware 307 and drops the locale.
    redirect(`/${await getLocale()}/${organizationSlug}`);
  }

  // Reuses the `roles` namespace's "seller" key: the fallback text here is
  // identical to that role label, so a separate `seller.*` translation
  // would just duplicate it.
  const t = await getTranslations("roles");
  const profile = await getProfile(user.id);
  const userEmail = user.email ?? "seller@ayam-norliza.local";
  const userName =
    profile?.displayName?.trim() || userEmail.split("@")[0] || t("seller");

  return (
    <SupabaseSessionProvider>
      <SidebarProvider>
        <AppSidebar
          organizationName={org.name}
          organizationSlug={organizationSlug}
          organizationRegion={org.region}
          userEmail={userEmail}
          userName={userName}
          role={member.role}
        />
        <SidebarInset className="min-w-0 overflow-x-hidden">
          <DashboardShellHeader
            organizationName={org.name}
            organizationSlug={organizationSlug}
          />
          <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden p-3 md:p-4">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </SupabaseSessionProvider>
  );
}
