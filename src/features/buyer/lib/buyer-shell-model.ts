export type BuyerRoute = {
  title: string;
  href: string;
  isActive: boolean;
};

export type BuyerRouteGroup = {
  title: string;
  isActive: boolean;
  items: BuyerRoute[];
};

type BuyerPathInput = {
  organizationSlug: string;
  pathname: string;
};

const routeGroups = [
  {
    title: "Shop",
    items: [
      { title: "Home", segment: "shop" },
    ],
  },
  {
    title: "My Account",
    items: [
      { title: "My Orders", segment: "orders" },
      { title: "Profile", segment: "profile" },
    ],
  },
] as const;

export function getBuyerSidebarGroups({
  organizationSlug,
  pathname,
}: BuyerPathInput): BuyerRouteGroup[] {
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

function isRouteActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
