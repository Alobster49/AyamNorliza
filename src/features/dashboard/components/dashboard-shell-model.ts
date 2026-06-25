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
};

const routeGroups = [
  {
    title: "Operations",
    items: [
      { title: "Overview", segment: "overview" },
      { title: "Alerts", segment: "alerts" },
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

export function getDashboardSidebarGroups({
  organizationSlug,
  pathname,
}: DashboardPathInput): DashboardRouteGroup[] {
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

export function getDashboardPageContext({
  organizationSlug,
  pathname,
}: DashboardPathInput): { section: string; title: string } {
  const groups = getDashboardSidebarGroups({ organizationSlug, pathname });
  const activeGroup = groups.find((group) => group.isActive);
  const activeItem = activeGroup?.items.find((item) => item.isActive);

  return {
    section: activeGroup?.title ?? "Operations",
    title: activeItem?.title ?? "Overview",
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

function isRouteActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
