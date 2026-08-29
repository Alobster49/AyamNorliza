import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { OrderPermissionError } from "@/features/orders/server/guards";
import { requirePermission } from "@/lib/auth/require-permission";
import { getOrganizationBySlug } from "@/features/identity-access/server/queries";
import { getCategories, getProducts } from "@/features/seller/server/actions";
import { notFound } from "next/navigation";
import { ProductsClient } from "./products-client";

export default async function ProductsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;

  // Layout admits all organization members; this page gates itself on products.view permission
  let ctx;
  try {
    ctx = await requirePermission(organizationSlug, "products", "view");
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      redirect({ href: `/${organizationSlug}`, locale: await getLocale() });
    }
    throw error;
  }

  const org = await getOrganizationBySlug(organizationSlug);
  if (!org) notFound();

  const categories = await getCategories(org.id);
  const products = await getProducts(org.id);

  return (
    <ProductsClient
      organizationId={org.id}
      organizationSlug={organizationSlug}
      initialCategories={categories}
      initialProducts={products}
    />
  );
}
