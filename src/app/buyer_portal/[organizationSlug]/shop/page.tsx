import { getPublicCatalog } from "@/features/buyer/server/actions";
import { ShopClient } from "./product-grid";

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
            Tiada produk lagi — datang balik nanti!
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-12">
      <section className="relative overflow-hidden rounded-3xl border bg-card px-6 py-14 sm:px-12 sm:py-20">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 85% 20%, var(--primary) 0, transparent 45%)",
          }}
        />
        <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
          Ladang AyamNorliza
        </p>
        <h1 className="font-buyer-display mt-3 max-w-2xl text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
          Ayam segar, ditimbang betul.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-muted-foreground">
          Pilih ayam anda hari ini — kami timbang depan mata dan sahkan harga ikut
          berat sebenar.
        </p>
      </section>

      <ShopClient categories={categories} />
    </div>
  );
}
