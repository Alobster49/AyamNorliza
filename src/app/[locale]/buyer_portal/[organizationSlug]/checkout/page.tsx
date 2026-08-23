import { getBuyerFromSession } from "@/lib/auth/buyer-auth";
import CheckoutClient from "./checkout-client";

type CheckoutPageProps = {
  params: Promise<{ organizationSlug: string }>;
};

export default async function CheckoutPage({ params }: CheckoutPageProps) {
  const { organizationSlug } = await params;
  // No redirect wall: anonymous buyers create their account inside checkout.
  const buyer = await getBuyerFromSession();
  return (
    <CheckoutClient
      organizationSlug={organizationSlug}
      initialBuyer={buyer ? { displayName: buyer.display_name, phone: buyer.phone } : null}
    />
  );
}
