import { isRouteActive } from "@/lib/i18n/route-active";

export type SellerRoute = {
  title: string;
  /** Message key (scoped to the `dashboard` namespace) for `title`. */
  titleKey: string;
  href: string;
  isActive: boolean;
};

export type SellerRouteGroup = {
  title: string;
  /** Message key (scoped to the `dashboard` namespace) for `title`. */
  sectionKey: string;
  isActive: boolean;
  items: SellerRoute[];
};

type SellerPathInput = {
  organizationSlug: string;
  pathname: string;
};

// Reuses the `dashboard` namespace's `sections.*`/`pages.*` keys: the label
// text here is identical to the dashboard sidebar's Sales group, so a
// separate `seller.*` translation would just duplicate it.
const routeGroups = [
  {
    title: "Sales",
    sectionKey: "sections.sales",
    items: [
      { title: "Products", titleKey: "pages.products", segment: "products" },
      { title: "Orders", titleKey: "pages.orders", segment: "orders" },
      { title: "Customers", titleKey: "pages.customers", segment: "customers" },
    ],
  },
] as const;

export function getSellerSidebarGroups({
  organizationSlug,
  pathname,
}: SellerPathInput): SellerRouteGroup[] {
  return routeGroups.map((group) => {
    const items = group.items.map((item) => {
      const href = `/${organizationSlug}/${item.segment}`;
      return {
        title: item.title,
        titleKey: item.titleKey,
        href,
        isActive: isRouteActive(pathname, href),
      };
    });

    return {
      title: group.title,
      sectionKey: group.sectionKey,
      isActive: items.some((item) => item.isActive),
      items,
    };
  });
}

export function getSellerPageContext({
  organizationSlug,
  pathname,
}: SellerPathInput): { section: string; title: string } {
  const groups = getSellerSidebarGroups({ organizationSlug, pathname });
  const activeGroup = groups.find((group) => group.isActive);
  const activeItem = activeGroup?.items.find((item) => item.isActive);

  // `section`/`title` are message keys scoped to the `dashboard` namespace
  // (e.g. resolve with `useTranslations("dashboard")`), not display text.
  return {
    section: activeGroup?.sectionKey ?? "sections.sales",
    title: activeItem?.titleKey ?? "pages.products",
  };
}

export function getUserInitials(name: string, email: string): string {
  const source = name.trim() || email.split("@")[0] || "User";
  const words = source
    .replace(/[^a-zA-Z0-9\s._-]/g, " ")
    .split(/[\s._-]+/)
    .filter(Boolean);

  if (words.length === 0) return "U";
  const first = words[0] ?? "U";
  const second = words[1];
  if (!second) return first.slice(0, 1).toUpperCase();

  return `${first.slice(0, 1)}${second.slice(0, 1)}`.toUpperCase();
}
