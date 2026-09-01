import { isRouteActive } from "@/lib/i18n/route-active";
import { grantKey, type PermissionAction } from "@/lib/auth/rbac";

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

type DashboardSidebarInput = {
  organizationSlug: string;
  pathname: string;
  grants: ReadonlySet<string>;
};

type DashboardPageContextInput = {
  organizationSlug: string;
  pathname: string;
};

type RouteItemDef = {
  titleKey: string;
  /** Path under `/{organizationSlug}/`. Ignored when `href` is set. */
  segment: string;
  /** Full path for pages that live outside the dashboard shell (the driver deck). */
  href?: (organizationSlug: string) => string;
  /** Resource key checked against the caller's grants (see `@/lib/auth/rbac`). */
  resource: string;
  /** Defaults to "view" — pass "use" for capability-style items (data console, access reviews, audit log). */
  action?: PermissionAction;
  /**
   * Hide the item from anyone who ALSO holds this grant. The driver deck is
   * only a destination for people whose job it is: the office (anyone who can
   * see delivery runs) opens a driver's deck from the runs page with ?run=,
   * and a bare /drive would just tell them "no run for you today".
   */
  hiddenIfGranted?: string;
};

// Canonical group/item order. Each item's visibility is driven entirely by
// whether the caller's grant set contains `resource:action` — no more
// role-branch constants (STAFF_ONLY_ROLES/ADMIN_ROLES/SALES_ROLES/
// APPROVER_ROLES). A group with zero visible items is dropped.
//
// "Driving" comes first so a driver who wanders into the shell (My Leave is
// the only reason) always has the way back to their deck at the top, and so
// the landing logic's "first visible item" is the deck for them.
const routeGroups = [
  {
    title: "Driving",
    sectionKey: "sections.driving",
    items: [
      {
        titleKey: "pages.driverDeck",
        segment: "drive",
        href: (slug: string) => `/drive/${slug}`,
        resource: "driver_deck",
        hiddenIfGranted: grantKey("delivery_runs", "view"),
      },
    ],
  },
  {
    title: "Sales",
    sectionKey: "sections.sales",
    items: [
      { titleKey: "pages.dashboard", segment: "dashboard", resource: "dashboard" },
      { titleKey: "pages.products", segment: "products", resource: "products" },
      { titleKey: "pages.orders", segment: "orders", resource: "orders" },
      { titleKey: "pages.customers", segment: "customers", resource: "customers" },
      { titleKey: "pages.marketPrices", segment: "market-prices", resource: "market_prices" },
    ],
  },
  {
    title: "Fulfillment",
    sectionKey: "sections.fulfillment",
    items: [
      { titleKey: "pages.warehouseTasks", segment: "tasks", resource: "warehouse_tasks" },
      { titleKey: "pages.dispatch", segment: "dispatch", resource: "dispatch" },
      { titleKey: "pages.loading", segment: "loading", resource: "loading" },
      { titleKey: "pages.deliveryRuns", segment: "runs", resource: "delivery_runs" },
      { titleKey: "pages.deliverySetup", segment: "delivery", resource: "delivery_setup" },
    ],
  },
  {
    title: "Access control",
    sectionKey: "sections.accessControl",
    items: [
      { titleKey: "pages.organization", segment: "settings/organization", resource: "settings" },
      { titleKey: "pages.users", segment: "settings/users", resource: "users" },
      { titleKey: "pages.roles", segment: "settings/roles", resource: "roles" },
      {
        titleKey: "pages.accessReviews",
        segment: "settings/access-reviews",
        resource: "access_review.run",
        action: "use",
      },
      {
        titleKey: "pages.auditLog",
        segment: "settings/audit-log",
        resource: "audit_log.read",
        action: "use",
      },
    ],
  },
  {
    title: "HR",
    sectionKey: "sections.hr",
    items: [
      { titleKey: "pages.myLeave", segment: "leave", resource: "leave" },
      { titleKey: "pages.leaveManagement", segment: "leave/manage", resource: "leave_management" },
    ],
  },
  {
    title: "System",
    sectionKey: "sections.system",
    items: [
      {
        titleKey: "pages.dataConsole",
        segment: "data-console",
        resource: "data_console.manage",
        action: "use",
      },
    ],
  },
] as const satisfies ReadonlyArray<{
  title: string;
  sectionKey: string;
  items: readonly RouteItemDef[];
}>;

function buildGroups(
  organizationSlug: string,
  pathname: string,
  isVisible: (def: RouteItemDef) => boolean,
): DashboardRouteGroup[] {
  const item = (def: RouteItemDef): DashboardRoute => {
    const href = def.href ? def.href(organizationSlug) : `/${organizationSlug}/${def.segment}`;
    return { titleKey: def.titleKey, href, isActive: isRouteActive(pathname, href) };
  };

  const groups: DashboardRouteGroup[] = [];
  for (const g of routeGroups) {
    const items = g.items.filter(isVisible).map(item);
    if (items.length === 0) continue;
    groups.push({
      title: g.title,
      sectionKey: g.sectionKey,
      isActive: items.some((i) => i.isActive),
      items,
    });
  }
  return groups;
}

/**
 * Sidebar nav groups filtered to what the caller's grant set permits. An
 * item shows iff `grants.has(grantKey(item.resource, item.action ?? "view"))`.
 */
export function getDashboardSidebarGroups({
  organizationSlug,
  pathname,
  grants,
}: DashboardSidebarInput): DashboardRouteGroup[] {
  return buildGroups(
    organizationSlug,
    pathname,
    (def) =>
      grants.has(grantKey(def.resource, def.action ?? "view")) &&
      !(def.hiddenIfGranted && grants.has(def.hiddenIfGranted)),
  );
}

/** Every nav item, ignoring grants — used only to resolve the header label. */
function getAllDashboardGroups(organizationSlug: string, pathname: string): DashboardRouteGroup[] {
  return buildGroups(organizationSlug, pathname, () => true);
}

export function getDashboardPageContext({
  organizationSlug,
  pathname,
}: DashboardPageContextInput): { section: string; title: string } {
  // Account pages live in the user menu, not the sidebar, so they resolve
  // here instead of through the sidebar groups.
  if (isRouteActive(pathname, `/${organizationSlug}/profile/security`)) {
    return { section: "sections.account", title: "pages.accountSecurity" };
  }

  // Built from the FULL unfiltered nav so the active section/title still
  // resolves for any page regardless of the caller's grants — this only
  // affects which label the header shows, never actual permissions (route
  // access is still enforced by each page's own permission guard).
  const groups = getAllDashboardGroups(organizationSlug, pathname);
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
