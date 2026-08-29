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

    expect(groups[2]).toMatchObject({
      title: "Access control",
      sectionKey: "sections.accessControl",
      isActive: true,
    });
    const orgItem = groups[2]?.items.find((item) => item.titleKey === "pages.organization");
    expect(orgItem?.isActive).toBe(true);
  });

  it("marks organization settings as the active sidebar item", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/settings/organization",
    });

    expect(groups[2]).toMatchObject({
      title: "Access control",
      sectionKey: "sections.accessControl",
      isActive: true,
    });
    const orgItem = groups[2]?.items.find((item) => item.titleKey === "pages.organization");
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

    expect(groups[2]).toMatchObject({
      title: "Access control",
      sectionKey: "sections.accessControl",
      isActive: true,
    });
  });

  it("returns page context for nested access control routes", () => {
    expect(
      getDashboardPageContext({
        organizationSlug: "ayam-norliza-pilot",
        pathname: "/ayam-norliza-pilot/settings/access-reviews/active",
      }),
    ).toEqual({
      section: "sections.accessControl",
      title: "pages.accessReviews",
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
      {
        titleKey: "pages.loading",
        href: "/ayam-norliza-pilot/loading",
        isActive: false,
      },
      {
        titleKey: "pages.myLeave",
        href: "/ayam-norliza-pilot/leave",
        isActive: false,
      },
    ]);
  });

  it.each(["seller", "supervisor"] as const)(
    "returns the sales-side nav (no dashboard) for the %s role",
    (role) => {
      const groups = getDashboardSidebarGroups({
        organizationSlug: "ayam-norliza-pilot",
        pathname: "/ayam-norliza-pilot/delivery",
        role,
      });

      expect(groups).toHaveLength(3);
      const salesTitleKeys = groups[0]?.items.map((item) => item.titleKey);
      expect(salesTitleKeys).toEqual([
        "pages.products",
        "pages.orders",
        "pages.customers",
        "pages.marketPrices",
      ]);

      expect(groups[1]).toMatchObject({
        title: "Fulfillment",
        sectionKey: "sections.fulfillment",
      });
      const deliverySetup = groups[1]?.items.find(
        (item) => item.titleKey === "pages.deliverySetup",
      );
      expect(deliverySetup).toMatchObject({
        titleKey: "pages.deliverySetup",
        href: "/ayam-norliza-pilot/delivery",
        isActive: true,
      });
      expect(groups[1]?.items.map((item) => item.titleKey)).toEqual([
        "pages.dispatch",
        "pages.deliveryRuns",
        "pages.deliverySetup",
      ]);

      // seller/supervisor are managers but not leave approvers: HR group
      // shows only My Leave, Leave Management is filtered out.
      const hrGroup = groups.find((group) => group.title === "HR");
      expect(hrGroup?.items.map((item) => item.titleKey)).toEqual(["pages.myLeave"]);
    },
  );

  it("returns the full nav when role is undefined (back-compat)", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/runs",
    });

    expect(groups).toHaveLength(4);
    const runsItem = groups[1]?.items.find((item) => item.titleKey === "pages.deliveryRuns");
    expect(runsItem).toMatchObject({
      titleKey: "pages.deliveryRuns",
      href: "/ayam-norliza-pilot/runs",
      isActive: true,
    });
  });

  it("gives the hr role both My Leave and Leave Management", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/leave/manage",
      role: "hr",
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      title: "HR",
      sectionKey: "sections.hr",
      isActive: true,
    });
    expect(groups[0]?.items).toEqual([
      {
        titleKey: "pages.myLeave",
        href: "/ayam-norliza-pilot/leave",
        // "/leave/manage" is nested under "/leave", so isRouteActive treats
        // My Leave as active too (prefix match) — same behavior as any
        // other nested route in this model.
        isActive: true,
      },
      {
        titleKey: "pages.leaveManagement",
        href: "/ayam-norliza-pilot/leave/manage",
        isActive: true,
      },
    ]);
  });

  it("gives the driver role My Leave only", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/leave",
      role: "driver",
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.title).toBe("HR");
    expect(groups[0]?.items).toEqual([
      {
        titleKey: "pages.myLeave",
        href: "/ayam-norliza-pilot/leave",
        isActive: true,
      },
    ]);
  });

  it("shows the owner the HR group including Leave Management", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/leave/manage",
      role: "owner",
    });

    const hrGroup = groups.find((group) => group.title === "HR");
    expect(hrGroup?.sectionKey).toBe("sections.hr");
    expect(hrGroup?.items).toEqual([
      {
        titleKey: "pages.myLeave",
        href: "/ayam-norliza-pilot/leave",
        // "/leave/manage" is nested under "/leave", so isRouteActive treats
        // My Leave as active too (prefix match) — same behavior as any
        // other nested route in this model.
        isActive: true,
      },
      {
        titleKey: "pages.leaveManagement",
        href: "/ayam-norliza-pilot/leave/manage",
        isActive: true,
      },
    ]);
  });

  it("keeps warehouse nav and adds My Leave for the inventory role", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/leave",
      role: "inventory",
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.title).toBe("Warehouse");
    expect(groups[0]?.items).toEqual([
      {
        titleKey: "pages.warehouseTasks",
        href: "/ayam-norliza-pilot/tasks",
        isActive: false,
      },
      {
        titleKey: "pages.loading",
        href: "/ayam-norliza-pilot/loading",
        isActive: false,
      },
      {
        titleKey: "pages.myLeave",
        href: "/ayam-norliza-pilot/leave",
        isActive: true,
      },
    ]);
  });

  it("splits sales and fulfillment into separate groups", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/dispatch",
    });

    expect(groups[0]).toMatchObject({
      title: "Sales",
      sectionKey: "sections.sales",
      isActive: false,
    });
    expect(groups[0]?.items.map((item) => item.titleKey)).toEqual([
      "pages.dashboard",
      "pages.products",
      "pages.orders",
      "pages.customers",
      "pages.marketPrices",
    ]);

    expect(groups[1]).toMatchObject({
      title: "Fulfillment",
      sectionKey: "sections.fulfillment",
      isActive: true,
    });
    expect(groups[1]?.items.map((item) => item.titleKey)).toEqual([
      "pages.warehouseTasks",
      "pages.dispatch",
      "pages.loading",
      "pages.deliveryRuns",
      "pages.deliverySetup",
    ]);
  });

  it("shows the Data console group to org_admin only, not owner", () => {
    const adminGroups = getDashboardSidebarGroups({
      organizationSlug: "org",
      pathname: "/org/data-console",
      role: "org_admin",
    });
    const system = adminGroups.find((g) => g.title === "System");
    expect(system?.sectionKey).toBe("sections.system");
    expect(system?.items).toEqual([
      {
        titleKey: "pages.dataConsole",
        href: "/org/data-console",
        isActive: true,
      },
    ]);

    for (const role of ["owner", "seller", undefined]) {
      const groups = getDashboardSidebarGroups({
        organizationSlug: "org",
        pathname: "/org/products",
        role,
      });
      expect(groups.find((g) => g.title === "System")).toBeUndefined();
    }
  });
});
