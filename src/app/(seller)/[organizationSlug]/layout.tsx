import { notFound, redirect } from "next/navigation";
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
  const user = await requireUserOrRedirect(`/${organizationSlug}`);

  // Check if user has seller role
  const supabase = await createClient();
  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();

  const { data: member } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", org.id)
    .eq("user_id", user.id)
    .single();

  // Only allow owner, org_admin, or seller roles
  if (!member || !["owner", "org_admin", "seller"].includes(member.role)) {
    redirect(`/${organizationSlug}`);
  }

  const profile = await getProfile(user.id);
  const userEmail = user.email ?? "seller@ayam-norliza.local";
  const userName =
    profile?.displayName?.trim() || userEmail.split("@")[0] || "Seller";

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
