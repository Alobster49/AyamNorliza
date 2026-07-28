import { getPublicCatalog } from "@/features/buyer/server/actions";
import { ProductGrid } from "./product-grid";

type ShopPageProps = {
  params: Promise<{ organizationSlug: string }>;
};

export default async function ShopPage({ params }: ShopPageProps) {
  const { organizationSlug } = await params;

  const result = await getPublicCatalog(organizationSlug);

  if (!result.ok) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Catalog Unavailable</h1>
          <p className="mt-2 text-muted-foreground">
            We could not load the product catalog. Please try again later.
          </p>
        </div>
      </div>
    );
  }

  const categories = result.data;

  if (categories.length === 0) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold">No Products Available</h1>
          <p className="mt-2 text-muted-foreground">
            Check back soon for our fresh products!
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-12">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-primary/10 via-primary/5 to-primary/10 px-6 py-12 text-center sm:px-12 sm:py-16">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Fresh from Our Farm to Your Table
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
          Browse our selection of premium poultry products, carefully raised and
          delivered fresh to your doorstep.
        </p>
      </section>

      <ProductGrid categories={categories} />
    </div>
  );
}
