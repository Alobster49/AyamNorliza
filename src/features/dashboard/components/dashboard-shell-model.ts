export type DashboardRoute = {
  title: string;
  href: string;
  isActive: boolean;
};

export type DashboardRouteGroup = {
  title: string;
  isActive: boolean;
  items: DashboardRoute[];
};

type DashboardPathInput = {
  organizationSlug: string;
  pathname: string;
  role?: string;
};

const routeGroups = [
  {
    title: "Sales",
    items: [
      { title: "Products", segment: "products" },
      { title: "Orders", segment: "orders" },
      { title: "Customers", segment: "customers" },
      { title: "Delivery setup", segment: "delivery" },
      { title: "Dispatch", segment: "dispatch" },
      { title: "Loading", segment: "loading" },
      { title: "Delivery runs", segment: "runs" },
      { title: "Warehouse tasks", segment: "tasks" },
    ],
  },
  {
    title: "Access control",
    items: [
      { title: "Organization", segment: "settings/organization" },
      { title: "Users", segment: "settings/users" },
      { title: "Roles", segment: "settings/roles" },
      { title: "Access reviews", segment: "settings/access-reviews" },
      { title: "Support sessions", segment: "settings/support-sessions" },
      { title: "Audit log", segment: "settings/audit-log" },
    ],
  },
] as const;

// Roles that only see the warehouse queue — no schedule admin, catalog, or
// customer data. Kept local (not imported from @/features/orders/lib/roles)
// so this dashboard-layer file has no dependency on the orders feature.
const STAFF_ONLY_ROLES = ["inventory", "logistics"] as const;

export function getDashboardSidebarGroups({
  organizationSlug,
  pathname,
  role,
}: DashboardPathInput): DashboardRouteGroup[] {
  if (role && (STAFF_ONLY_ROLES as readonly string[]).includes(role)) {
    const tasksHref = `/${organizationSlug}/tasks`;
    const items = [
      { title: "Warehouse tasks", href: tasksHref, isActive: isRouteActive(pathname, tasksHref) },
    ];
    if (role === "logistics") {
      const dispatchHref = `/${organizationSlug}/dispatch`;
      items.push({ title: "Dispatch", href: dispatchHref, isActive: isRouteActive(pathname, dispatchHref) });
      const loadingHref = `/${organizationSlug}/loading`;
      items.push({ title: "Loading", href: loadingHref, isActive: isRouteActive(pathname, loadingHref) });
    }
    return [{ title: "Warehouse", isActive: items.some((item) => item.isActive), items }];
  }

  const groups: DashboardRouteGroup[] = routeGroups.map((group) => {
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

  if (role === "owner") {
    const consoleHref = `/${organizationSlug}/data-console`;
    groups.push({
      title: "System",
      isActive: isRouteActive(pathname, consoleHref),
      items: [
        {
          title: "Data console",
          href: consoleHref,
          isActive: isRouteActive(pathname, consoleHref),
        },
      ],
    });
  }

  return groups;
}

export function getDashboardPageContext({
  organizationSlug,
  pathname,
}: DashboardPathInput): { section: string; title: string } {
  const groups = getDashboardSidebarGroups({ organizationSlug, pathname });
  const activeGroup = groups.find((group) => group.isActive);
  const activeItem = activeGroup?.items.find((item) => item.isActive);

  return {
    section: activeGroup?.title ?? "Access control",
    title: activeItem?.title ?? "Organization",
  };
}

export function getDefaultPageContext(section: string): string {
  if (section === "Sales") return "Products";
  return "Organization";
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

function isRouteActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
