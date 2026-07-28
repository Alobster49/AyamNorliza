import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSessionProvider } from "@/components/providers/supabase-session-provider";
import { BuyerHeader } from "@/features/buyer/components/buyer-header";
import { CartProvider } from "@/features/buyer/components/cart-context";

type BuyerLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ organizationSlug: string }>;
};

export default async function BuyerLayout({
  children,
  params,
}: BuyerLayoutProps) {
  const { organizationSlug } = await params;
  // Note: Organization verification is deferred to page-level checks
  // to allow public browsing without auth

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let buyerName: string | undefined;
  let isLoggedIn = false;

  if (user) {
    const { data: buyer } = await supabase
      .from("buyers")
      .select("display_name")
      .eq("id", user.id)
      .single();

    if (buyer) {
      buyerName = buyer.display_name;
      isLoggedIn = true;
    }
  }

  return (
    <SupabaseSessionProvider>
      <CartProvider>
        <div className="min-h-screen bg-background">
          <BuyerHeader
            organizationSlug={organizationSlug}
            buyerName={buyerName}
            isLoggedIn={isLoggedIn}
          />
          <main className="container mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </main>
        </div>
      </CartProvider>
    </SupabaseSessionProvider>
  );
}
