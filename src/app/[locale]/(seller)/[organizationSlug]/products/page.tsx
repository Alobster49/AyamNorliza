import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { OrderPermissionError } from "@/features/orders/server/guards";
import { requirePermission } from "@/lib/auth/require-permission";
import { getCategories, getProducts } from "@/features/seller/server/actions";
import { ProductsClient } from "./products-client";

export default async function ProductsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;

  // Layout admits all organization members; this page gates itself on products.view permission
  let orgId: string;
  try {
    ({ orgId } = await requirePermission(organizationSlug, "products", "view"));
  } catch (error) {
    if (error instanceof OrderPermissionError) {
      redirect({ href: `/${organizationSlug}`, locale: await getLocale() });
    }
    throw error;
  }

  const categories = await getCategories(organizationSlug);
  const products = await getProducts(organizationSlug);

  return (
    <ProductsClient
      organizationId={orgId}
      organizationSlug={organizationSlug}
      initialCategories={categories}
      initialProducts={products}
    />
  );
}
