import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DRIVER_AND_MANAGER_ROLES } from "@/features/orders/lib/roles";
import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import { SupabaseSessionProvider } from "@/components/providers/supabase-session-provider";

/**
 * The driver deck lives outside the seller shell on purpose. A driver has no
 * sidebar, no org navigation and no business seeing one — this route is the
 * whole application as far as they are concerned, and it has to survive being
 * opened one-handed in a truck. The column widens on tablet/desktop so the
 * office can drive the same screen from a laptop without a phone-sized strip.
 */
export default async function DriveLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const user = await requireUserOrRedirect(`/drive/${organizationSlug}`);

  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();

  const supabase = await createSupabaseServerClient();
  const { data: member } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", org.id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (!member || !DRIVER_AND_MANAGER_ROLES.includes(member.role as never)) {
    redirect({ href: "/", locale: await getLocale() });
  }

  return (
    <SupabaseSessionProvider>
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background sm:max-w-3xl lg:max-w-6xl">
        {children}
      </div>
    </SupabaseSessionProvider>
  );
}
