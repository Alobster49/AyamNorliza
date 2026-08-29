import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getOrganizationBySlug,
  getProfile,
} from "@/features/identity-access/server/queries";
import { SupabaseSessionProvider } from "@/components/providers/supabase-session-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/features/dashboard/components/app-sidebar";
import { DashboardShellHeader } from "@/features/dashboard/components/dashboard-shell-header";

export default async function OrganizationLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const user = await requireUserOrRedirect(`/${organizationSlug}`, { requireAal2: true });
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();

  // Being signed in is not enough: the caller must still be an *active*
  // member of this organization. Without this, a suspended/deactivated user
  // kept full dashboard access until their access token expired, and any
  // authenticated user could load another organization's shell. Mirrors the
  // membership check in the (seller) layout.
  const supabase = await createSupabaseServerClient();
  const { data: member } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", org.id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  // Locale-prefixed explicitly (same pattern as `requireUserOrRedirect`):
  // a bare `/login` here bounced through the middleware's 307 and dropped
  // the active locale.
  if (!member) redirect(`/${await getLocale()}/login`);

  const t = await getTranslations("dashboard");
  const profile = await getProfile(user.id);
  const userEmail = user.email ?? "signed-in-user@ayam-norliza.local";
  const userName =
    profile?.displayName?.trim() ||
    userEmail.split("@")[0] ||
    t("fallbackUserName");

  return (
    <SupabaseSessionProvider>
      <SidebarProvider>
        <AppSidebar
          organizationName={org.name}
          organizationSlug={organizationSlug}
          organizationRegion={org.region}
          userEmail={userEmail}
          userName={userName}
          userId={user.id}
          userAvatar={profile?.avatar ?? null}
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
