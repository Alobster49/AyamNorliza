import { notFound } from "next/navigation";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
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
  const user = await requireUserOrRedirect(`/${organizationSlug}`);
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();
  const profile = await getProfile(user.id);
  const userEmail = user.email ?? "signed-in-user@ayam-norliza.local";
  const userName =
    profile?.displayName?.trim() || userEmail.split("@")[0] || "Team member";

  return (
    <SupabaseSessionProvider>
      <SidebarProvider>
        <AppSidebar
          organizationName={org.name}
          organizationSlug={organizationSlug}
          organizationRegion={org.region}
          userEmail={userEmail}
          userName={userName}
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
