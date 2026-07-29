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
