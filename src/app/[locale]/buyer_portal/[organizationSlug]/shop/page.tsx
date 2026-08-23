import { getTranslations } from "next-intl/server";
import { getPublicCatalog, getOrganizationBySlug } from "@/features/buyer/server/actions";
import { ShopClient } from "./product-grid";

type ShopPageProps = {
  params: Promise<{ organizationSlug: string }>;
};

export default async function ShopPage({ params }: ShopPageProps) {
  const { organizationSlug } = await params;
  const t = await getTranslations("buyer.shop");

  const [result, org] = await Promise.all([
    getPublicCatalog(organizationSlug),
    getOrganizationBySlug(organizationSlug),
  ]);

  if (!result.ok) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold">{t("errorTitle")}</h1>
          <p className="mt-2 text-muted-foreground">{t("errorBody")}</p>
        </div>
      </div>
    );
  }

  const categories = result.data;

  if (categories.length === 0) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold">{t("emptyTitle")}</h1>
          <p className="mt-2 text-muted-foreground">{t("emptyBody")}</p>
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
          {org?.name ? t("farmEyebrow", { name: org.name }) : t("farmEyebrowFallback")}
        </p>
        <h1 className="font-buyer-display mt-3 max-w-2xl text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
          {t("heroTitle")}
        </h1>
        <p className="mt-4 max-w-xl text-lg text-muted-foreground">{t("heroBody")}</p>
      </section>

      <ShopClient categories={categories} />
    </div>
  );
}
