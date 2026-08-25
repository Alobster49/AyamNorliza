import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getPublicCatalog, getOrganizationBySlug } from "@/features/buyer/server/actions";
import { ShopClient } from "./product-grid";

type ShopPageProps = {
  params: Promise<{ locale: string; organizationSlug: string }>;
};

export default async function ShopPage({ params }: ShopPageProps) {
  const { locale, organizationSlug } = await params;
  // Required alongside the `[locale]` layout's own call: the layout enables
  // static generation via `generateStaticParams`, and without a per-page call
  // too, next-intl's request-scoped locale can leak across concurrent
  // requests (e.g. a client-side `router.push` landing here right after a
  // request for the other locale) - see next-intl's static-rendering docs.
  setRequestLocale(locale);
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
      <section className="relative overflow-hidden rounded-3xl border bg-card px-6 py-6 text-center sm:px-12 sm:py-8">
        <h1 className="flex justify-center">
          <Image
            src="/logo-ayam-norliza.png"
            alt={org?.name ? t("farmEyebrow", { name: org.name }) : t("farmEyebrowFallback")}
            width={2479}
            height={870}
            priority
            className="h-28 w-auto sm:h-40"
          />
        </h1>
        <div aria-hidden className="mx-auto mt-4 h-[3px] w-14 rounded-full bg-primary" />
        <p className="mt-3 text-[13px] uppercase tracking-[0.22em] text-muted-foreground">
          Bersih <span className="text-primary">·</span> Segar{" "}
          <span className="text-primary">·</span> Suci <span className="text-primary">·</span> Halal
        </p>
      </section>

      <ShopClient categories={categories} />
    </div>
  );
}
