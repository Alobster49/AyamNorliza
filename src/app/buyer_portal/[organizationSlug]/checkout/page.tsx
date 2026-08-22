import { requireBuyerOrRedirect } from "@/lib/auth/buyer-auth";
import CheckoutClient from "./checkout-client";

type CheckoutPageProps = {
  params: Promise<{ organizationSlug: string }>;
};

export default async function CheckoutPage({ params }: CheckoutPageProps) {
  const { organizationSlug } = await params;
  // The guard builds the same `?next=` this page used to hand-roll, from the
  // path the middleware publishes.
  await requireBuyerOrRedirect(organizationSlug);
  return <CheckoutClient organizationSlug={organizationSlug} />;
}
