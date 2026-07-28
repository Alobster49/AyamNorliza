export type SellerRoute = {
  title: string;
  href: string;
  isActive: boolean;
};

export type SellerRouteGroup = {
  title: string;
  isActive: boolean;
  items: SellerRoute[];
};

type SellerPathInput = {
  organizationSlug: string;
  pathname: string;
};

const routeGroups = [
  {
    title: "Sales",
    items: [
      { title: "Products", segment: "products" },
      { title: "Orders", segment: "orders" },
      { title: "Customers", segment: "customers" },
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
        href,
        isActive: isRouteActive(pathname, href),
      };
    });

    return {
      title: group.title,
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

  return {
    section: activeGroup?.title ?? "Sales",
    title: activeItem?.title ?? "Products",
  };
}

function isRouteActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
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
