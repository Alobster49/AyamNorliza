import { describe, expect, it } from "vitest";
import {
  getDashboardPageContext,
  getDashboardSidebarGroups,
  getUserInitials,
} from "../../components/dashboard-shell-model";

describe("dashboard shell model", () => {
  it("still highlights the right item when pathname is locale-prefixed", () => {
    // getDashboardSidebarGroups builds hrefs like "/{slug}/settings/organization"
    // and compares them against whatever `pathname` the caller passes in.
    // The sidebar component is expected to supply an UNPREFIXED pathname
    // (via next-intl's `usePathname` from "@/i18n/navigation", not
    // "next/navigation" - see app-sidebar.tsx), but the shared
    // `isRouteActive` helper (`src/lib/i18n/route-active.ts`) strips a
    // locale prefix defensively, so a caller that regresses back to the
    // wrong `usePathname` still highlights correctly instead of silently
    // breaking every active state. This pins that hardening at the model
    // level, once, rather than three near-identical local copies.
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/en/ayam-norliza-pilot/settings/organization",
    });

    expect(groups[1]).toMatchObject({
      title: "Access control",
      sectionKey: "sections.accessControl",
      isActive: true,
    });
    const orgItem = groups[1]?.items.find((item) => item.titleKey === "pages.organization");
    expect(orgItem?.isActive).toBe(true);
  });

  it("marks organization settings as the active sidebar item", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/settings/organization",
    });

    expect(groups[1]).toMatchObject({
      title: "Access control",
      sectionKey: "sections.accessControl",
      isActive: true,
    });
    const orgItem = groups[1]?.items.find((item) => item.titleKey === "pages.organization");
    expect(orgItem).toMatchObject({
      titleKey: "pages.organization",
      href: "/ayam-norliza-pilot/settings/organization",
      isActive: true,
    });
  });

  it("marks users as the active sidebar item", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/settings/users",
    });

    expect(groups[1]).toMatchObject({
      title: "Access control",
      sectionKey: "sections.accessControl",
      isActive: true,
    });
  });

  it("returns page context for nested access control routes", () => {
    expect(
      getDashboardPageContext({
        organizationSlug: "ayam-norliza-pilot",
        pathname: "/ayam-norliza-pilot/settings/support-sessions/active",
      }),
    ).toEqual({
      section: "sections.accessControl",
      title: "pages.supportSessions",
    });
  });

  it("returns the System section for the data console page", () => {
    expect(
      getDashboardPageContext({
        organizationSlug: "ayam-norliza-pilot",
        pathname: "/ayam-norliza-pilot/data-console",
      }),
    ).toEqual({
      section: "sections.system",
      title: "pages.dataConsole",
    });
  });

  it("returns access control as default page context for unknown routes", () => {
    expect(
      getDashboardPageContext({
        organizationSlug: "ayam-norliza-pilot",
        pathname: "/ayam-norliza-pilot/unknown",
      }),
    ).toEqual({
      section: "sections.accessControl",
      title: "pages.organization",
    });
  });

  it("formats fallback user initials from display name or email", () => {
    expect(getUserInitials("Ayam Norliza", "owner@example.com")).toBe("AN");
    expect(getUserInitials("", "owner@example.com")).toBe("O");
  });

  it("returns only the warehouse group for staff roles", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/tasks",
      role: "inventory",
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      title: "Warehouse",
      sectionKey: "sections.warehouse",
      isActive: true,
    });
    expect(groups[0]?.items).toEqual([
      {
        titleKey: "pages.warehouseTasks",
        href: "/ayam-norliza-pilot/tasks",
        isActive: true,
      },
    ]);
  });

  it("returns only the warehouse group for the logistics role too", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/orders",
      role: "logistics",
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.title).toBe("Warehouse");
    expect(groups[0]?.sectionKey).toBe("sections.warehouse");
    expect(groups[0]?.items[0]).toMatchObject({ isActive: false });
    expect(groups[0]?.items).toEqual([
      {
        titleKey: "pages.warehouseTasks",
        href: "/ayam-norliza-pilot/tasks",
        isActive: false,
      },
      {
        titleKey: "pages.dispatch",
        href: "/ayam-norliza-pilot/dispatch",
        isActive: false,
      },
      {
        titleKey: "pages.loading",
        href: "/ayam-norliza-pilot/loading",
        isActive: false,
      },
    ]);
  });

  it("returns the full nav with delivery segments for manager roles", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/delivery",
      role: "seller",
    });

    expect(groups).toHaveLength(2);
    const salesTitleKeys = groups[0]?.items.map((item) => item.titleKey);
    expect(salesTitleKeys).toEqual([
      "pages.dashboard",
      "pages.products",
      "pages.orders",
      "pages.customers",
      "pages.marketPrices",
      "pages.deliverySetup",
      "pages.dispatch",
      "pages.loading",
      "pages.deliveryRuns",
      "pages.warehouseTasks",
    ]);
    const deliverySetup = groups[0]?.items.find((item) => item.titleKey === "pages.deliverySetup");
    expect(deliverySetup).toMatchObject({
      titleKey: "pages.deliverySetup",
      href: "/ayam-norliza-pilot/delivery",
      isActive: true,
    });
  });

  it("returns the full nav when role is undefined (back-compat)", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/runs",
    });

    expect(groups).toHaveLength(2);
    const runsItem = groups[0]?.items.find((item) => item.titleKey === "pages.deliveryRuns");
    expect(runsItem).toMatchObject({
      titleKey: "pages.deliveryRuns",
      href: "/ayam-norliza-pilot/runs",
      isActive: true,
    });
  });

  it("shows the Data console group to owners only", () => {
    const ownerGroups = getDashboardSidebarGroups({
      organizationSlug: "org",
      pathname: "/org/data-console",
      role: "owner",
    });
    const system = ownerGroups.find((g) => g.title === "System");
    expect(system?.sectionKey).toBe("sections.system");
    expect(system?.items).toEqual([
      {
        titleKey: "pages.dataConsole",
        href: "/org/data-console",
        isActive: true,
      },
    ]);

    for (const role of ["seller", "org_admin", undefined]) {
      const groups = getDashboardSidebarGroups({
        organizationSlug: "org",
        pathname: "/org/products",
        role,
      });
      expect(groups.find((g) => g.title === "System")).toBeUndefined();
    }
  });
});
