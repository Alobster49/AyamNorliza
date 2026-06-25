import { notFound } from "next/navigation";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import { SupabaseSessionProvider } from "@/components/providers/supabase-session-provider";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { AppSidebar } from "@/features/dashboard/components/app-sidebar";

export default async function OrganizationLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { organizationSlug: string };
}) {
  await requireUserOrRedirect(`/${params.organizationSlug}`);
  const org = await getOrganizationBySlug(params.organizationSlug);
  if (!org) notFound();

  return (
    <SupabaseSessionProvider>
      <SidebarProvider>
        <AppSidebar organizationName={org.name} organizationSlug={params.organizationSlug} />
        <SidebarInset>
          <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="h-4" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{org.name}</p>
              <p className="hidden text-xs text-muted-foreground sm:block">
                Operations command center
              </p>
            </div>
            <ThemeToggle />
          </header>
          <div className="flex flex-1 flex-col p-4 md:p-6">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </SupabaseSessionProvider>
  );
}
