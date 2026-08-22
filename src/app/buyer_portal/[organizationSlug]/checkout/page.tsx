import { redirect } from "next/navigation";
import { requireBuyer, NotABuyerError } from "@/lib/auth/buyer-auth";
import CheckoutClient from "./checkout-client";

type CheckoutPageProps = {
  params: Promise<{ organizationSlug: string }>;
};

export default async function CheckoutPage({ params }: CheckoutPageProps) {
  const { organizationSlug } = await params;
  try {
    await requireBuyer();
  } catch (e) {
    if (e instanceof NotABuyerError) {
      const next = encodeURIComponent(`/buyer_portal/${organizationSlug}/checkout`);
      redirect(`/buyer_portal/${organizationSlug}/login?next=${next}`);
    }
    throw e;
  }
  return <CheckoutClient organizationSlug={organizationSlug} />;
}
