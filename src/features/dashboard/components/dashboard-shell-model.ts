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
    ],
  },
  {
    title: "Fulfillment",
    sectionKey: "sections.fulfillment",
    items: [
      { titleKey: "pages.warehouseTasks", segment: "tasks" },
      { titleKey: "pages.dispatch", segment: "dispatch" },
      { titleKey: "pages.loading", segment: "loading" },
      { titleKey: "pages.deliveryRuns", segment: "runs" },
      { titleKey: "pages.deliverySetup", segment: "delivery" },
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
      { titleKey: "pages.auditLog", segment: "settings/audit-log" },
    ],
  },
  {
    title: "HR",
    sectionKey: "sections.hr",
    items: [
      { titleKey: "pages.myLeave", segment: "leave" },
      { titleKey: "pages.leaveManagement", segment: "leave/manage" },
    ],
  },
] as const;

// Worker ("inventory" is the stored value) only sees the warehouse queue,
// loading, and My Leave. Kept local (not imported from
// @/features/orders/lib/roles) so this dashboard-layer file has no
// dependency on the orders feature.
const STAFF_ONLY_ROLES = ["inventory"] as const;

// Owner + Admin get the full nav (Sales/Fulfillment/Access control/HR).
// Kept local (not imported from @/features/orders/lib/roles), same
// reasoning as STAFF_ONLY_ROLES above.
const ADMIN_ROLES = ["owner", "org_admin"] as const;

// Seller and Supervisor share the sales-side nav: products, orders,
// customers, market prices, dispatch, delivery runs, delivery setup, and
// My Leave — no sales dashboard, warehouse queue, loading, or settings.
const SALES_ROLES = ["seller", "supervisor"] as const;

// Roles that may open Leave Management, not just My Leave. Kept local (not
// imported from @/features/hr/lib/roles) for the same reason.
const APPROVER_ROLES = ["owner", "org_admin", "hr"] as const;

export function getDashboardSidebarGroups({
  organizationSlug,
  pathname,
  role,
}: DashboardPathInput): DashboardRouteGroup[] {
  const item = (titleKey: string, segment: string): DashboardRoute => {
    const href = `/${organizationSlug}/${segment}`;
    return { titleKey, href, isActive: isRouteActive(pathname, href) };
  };
  const group = (
    title: string,
    sectionKey: string,
    items: DashboardRoute[],
  ): DashboardRouteGroup => ({
    title,
    sectionKey,
    isActive: items.some((i) => i.isActive),
    items,
  });

  if (role && (STAFF_ONLY_ROLES as readonly string[]).includes(role)) {
    return [
      group("Warehouse", "sections.warehouse", [
        item("pages.warehouseTasks", "tasks"),
        item("pages.loading", "loading"),
        item("pages.myLeave", "leave"),
      ]),
    ];
  }

  if (role && (SALES_ROLES as readonly string[]).includes(role)) {
    return [
      group("Sales", "sections.sales", [
        item("pages.products", "products"),
        item("pages.orders", "orders"),
        item("pages.customers", "customers"),
        item("pages.marketPrices", "market-prices"),
      ]),
      group("Fulfillment", "sections.fulfillment", [
        item("pages.dispatch", "dispatch"),
        item("pages.deliveryRuns", "runs"),
        item("pages.deliverySetup", "delivery"),
      ]),
      group("HR", "sections.hr", [item("pages.myLeave", "leave")]),
    ];
  }

  // Roles that are neither admins, sales, nor warehouse (driver, hr) get
  // just the HR group: My Leave for everyone, Leave Management only for
  // approvers.
  if (role && !(ADMIN_ROLES as readonly string[]).includes(role)) {
    const items: DashboardRoute[] = [item("pages.myLeave", "leave")];
    if ((APPROVER_ROLES as readonly string[]).includes(role)) {
      items.push(item("pages.leaveManagement", "leave/manage"));
    }
    return [group("HR", "sections.hr", items)];
  }

  const groups: DashboardRouteGroup[] = routeGroups.map((g) =>
    group(
      g.title,
      g.sectionKey,
      g.items.map((i) => item(i.titleKey, i.segment)),
    ),
  );

  // Data console is admin-only: the owner runs the business, the admin runs
  // the system.
  if (role === "org_admin") {
    groups.push(
      group("System", "sections.system", [
        item("pages.dataConsole", "data-console"),
      ]),
    );
  }

  return groups;
}

export function getDashboardPageContext({
  organizationSlug,
  pathname,
}: DashboardPathInput): { section: string; title: string } {
  // Pass role: "org_admin" so the admin-only System group (Data console) is
  // considered when resolving the active section/title. Route access to
  // those pages is admin-gated anyway, so this only affects which label the
  // header shows, never actual permissions.
  // Account pages live in the user menu, not the sidebar, so they resolve
  // here instead of through the sidebar groups.
  if (isRouteActive(pathname, `/${organizationSlug}/profile/security`)) {
    return { section: "sections.account", title: "pages.accountSecurity" };
  }

  const groups = getDashboardSidebarGroups({ organizationSlug, pathname, role: "org_admin" });
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

