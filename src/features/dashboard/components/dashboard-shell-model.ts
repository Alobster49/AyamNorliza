import { isRouteActive } from "@/lib/i18n/route-active";

export type DashboardRoute = {
  /** Message key (scoped to the `dashboard` namespace) for the display label. */
  titleKey: string;
  href: string;
  isActive: boolean;
};

export type DashboardRouteGroup = {
  title: string;
  /** Message key (scoped to the `dashboard` namespace) for `title`. */
  sectionKey: string;
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
    sectionKey: "sections.sales",
    items: [
      { titleKey: "pages.dashboard", segment: "dashboard" },
      { titleKey: "pages.products", segment: "products" },
      { titleKey: "pages.orders", segment: "orders" },
      { titleKey: "pages.customers", segment: "customers" },
      { titleKey: "pages.marketPrices", segment: "market-prices" },
      { titleKey: "pages.deliverySetup", segment: "delivery" },
      { titleKey: "pages.dispatch", segment: "dispatch" },
      { titleKey: "pages.loading", segment: "loading" },
      { titleKey: "pages.deliveryRuns", segment: "runs" },
      { titleKey: "pages.warehouseTasks", segment: "tasks" },
    ],
  },
  {
    title: "Access control",
    sectionKey: "sections.accessControl",
    items: [
      { titleKey: "pages.organization", segment: "settings/organization" },
      { titleKey: "pages.users", segment: "settings/users" },
      { titleKey: "pages.roles", segment: "settings/roles" },
      { titleKey: "pages.accessReviews", segment: "settings/access-reviews" },
      { titleKey: "pages.supportSessions", segment: "settings/support-sessions" },
      { titleKey: "pages.auditLog", segment: "settings/audit-log" },
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
    const items: DashboardRoute[] = [
      {
        titleKey: "pages.warehouseTasks",
        href: tasksHref,
        isActive: isRouteActive(pathname, tasksHref),
      },
    ];
    if (role === "logistics") {
      const dispatchHref = `/${organizationSlug}/dispatch`;
      items.push({
        titleKey: "pages.dispatch",
        href: dispatchHref,
        isActive: isRouteActive(pathname, dispatchHref),
      });
      const loadingHref = `/${organizationSlug}/loading`;
      items.push({
        titleKey: "pages.loading",
        href: loadingHref,
        isActive: isRouteActive(pathname, loadingHref),
      });
    }
    return [
      {
        title: "Warehouse",
        sectionKey: "sections.warehouse",
        isActive: items.some((item) => item.isActive),
        items,
      },
    ];
  }

  const groups: DashboardRouteGroup[] = routeGroups.map((group) => {
    const items = group.items.map((item) => {
      const href = `/${organizationSlug}/${item.segment}`;
      return {
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

  if (role === "owner") {
    const consoleHref = `/${organizationSlug}/data-console`;
    groups.push({
      title: "System",
      sectionKey: "sections.system",
      isActive: isRouteActive(pathname, consoleHref),
      items: [
        {
          titleKey: "pages.dataConsole",
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
  // Pass role: "owner" so the owner-only System group (Data console) is
  // considered when resolving the active section/title. Route access to
  // those pages is owner-gated anyway, so this only affects which label the
  // header shows, never actual permissions.
  const groups = getDashboardSidebarGroups({ organizationSlug, pathname, role: "owner" });
  const activeGroup = groups.find((group) => group.isActive);
  const activeItem = activeGroup?.items.find((item) => item.isActive);

  // `section`/`title` are message keys scoped to the `dashboard` namespace
  // (e.g. resolve with `useTranslations("dashboard")`), not display text.
  return {
    section: activeGroup?.sectionKey ?? "sections.accessControl",
    title: activeItem?.titleKey ?? "pages.organization",
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

