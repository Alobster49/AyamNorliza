import { setRequestLocale } from "next-intl/server";
import { getBuyerFromSession } from "@/lib/auth/buyer-auth";
import CheckoutClient from "./checkout-client";

type CheckoutPageProps = {
  params: Promise<{ locale: string; organizationSlug: string }>;
};

export default async function CheckoutPage({ params }: CheckoutPageProps) {
  const { locale, organizationSlug } = await params;
  // Required alongside the `[locale]` layout's own call - see the comment on
  // ShopPage for why every page needs this, not just the layout.
  setRequestLocale(locale);
  // No redirect wall: anonymous buyers create their account inside checkout.
  const buyer = await getBuyerFromSession();
  return (
    <CheckoutClient
      organizationSlug={organizationSlug}
      initialBuyer={buyer ? { displayName: buyer.display_name, phone: buyer.phone } : null}
    />
  );
}
