import { getBuyerFromSession } from "@/lib/auth/buyer-auth";
import { SupabaseSessionProvider } from "@/components/providers/supabase-session-provider";
import { BuyerHeader } from "@/features/buyer/components/buyer-header";
import { CartProvider } from "@/features/buyer/components/cart-context";
import { CartUiProvider } from "@/features/buyer/components/cart-ui-context";
import { CartOverlay } from "@/features/buyer/components/cart-overlay";

type BuyerLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ organizationSlug: string }>;
};

export default async function BuyerLayout({ children, params }: BuyerLayoutProps) {
  const { organizationSlug } = await params;
  // Cross-checked against `organizationSlug`, not just `buyers.id = user.id`
  // - otherwise an Org A buyer browsing Org B's portal reads as logged in
  // here, header identity and all. See `getBuyerFromSession`.
  const buyer = await getBuyerFromSession(organizationSlug);
  const buyerName = buyer?.display_name;
  const isLoggedIn = buyer !== null;

  return (
    <SupabaseSessionProvider>
      <CartProvider>
        <CartUiProvider>
          <div className="buyer-theme min-h-screen">
            <BuyerHeader
              organizationSlug={organizationSlug}
              buyerName={buyerName}
              isLoggedIn={isLoggedIn}
            />
            {/* Extra bottom padding on mobile: `CartOverlay`'s floating
                "View Cart" bar is `fixed` at the viewport bottom whenever
                the cart has items (see cart-overlay.tsx), and without this
                clearance it sits directly over the last product row's
                "+ Add" button. Reverts to the normal py-6 on sm+, where the
                bar is a smaller fraction of the viewport. */}
            <main className="container mx-auto max-w-7xl px-4 py-6 pb-28 sm:px-6 sm:pb-6 lg:px-8">
              {children}
            </main>
            <CartOverlay organizationSlug={organizationSlug} />
          </div>
        </CartUiProvider>
      </CartProvider>
    </SupabaseSessionProvider>
  );
}
