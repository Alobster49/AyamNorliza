import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_GRANTS } from "@/lib/auth/rbac";
import {
  getDashboardPageContext,
  getDashboardSidebarGroups,
  getUserInitials,
} from "../../components/dashboard-shell-model";

const groupsFor = (grants: ReadonlySet<string>, pathname = "/acme/products") =>
  getDashboardSidebarGroups({ organizationSlug: "acme", pathname, grants });

const flat = (gs: ReturnType<typeof groupsFor>) => gs.flatMap((g) => g.items.map((i) => i.titleKey));

describe("permission-driven nav", () => {
  it("seller sees sales pages, no dashboard/settings", () => {
    const keys = flat(groupsFor(DEFAULT_ROLE_GRANTS.seller));
    expect(keys).toContain("pages.products");
    expect(keys).not.toContain("pages.dashboard");
    expect(keys).not.toContain("pages.loading");
  });
  it("worker sees warehouse only", () => {
    const keys = flat(groupsFor(DEFAULT_ROLE_GRANTS.inventory));
    expect(keys).toEqual(expect.arrayContaining(["pages.warehouseTasks", "pages.loading", "pages.myLeave"]));
    expect(keys).not.toContain("pages.orders");
  });
  it("admin sees data console, owner does not", () => {
    expect(flat(groupsFor(DEFAULT_ROLE_GRANTS.org_admin))).toContain("pages.dataConsole");
    expect(flat(groupsFor(DEFAULT_ROLE_GRANTS.owner))).not.toContain("pages.dataConsole");
  });
  it("view-only custom role sees just its page", () => {
    expect(flat(groupsFor(new Set(["products:view"])))).toEqual(["pages.products"]);
  });
});

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
      grants: DEFAULT_ROLE_GRANTS.org_admin,
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
      grants: DEFAULT_ROLE_GRANTS.org_admin,
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
      grants: DEFAULT_ROLE_GRANTS.org_admin,
    });

    expect(groups[2]).toMatchObject({
      title: "Access control",
      sectionKey: "sections.accessControl",
      isActive: true,
    });
  });

  it("returns page context for nested access control routes regardless of grants", () => {
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

  it("resolves the account security page context without touching the sidebar groups", () => {
    expect(
      getDashboardPageContext({
        organizationSlug: "ayam-norliza-pilot",
        pathname: "/ayam-norliza-pilot/profile/security",
      }),
    ).toEqual({
      section: "sections.account",
      title: "pages.accountSecurity",
    });
  });

  it("formats fallback user initials from display name or email", () => {
    expect(getUserInitials("Ayam Norliza", "owner@example.com")).toBe("AN");
    expect(getUserInitials("", "owner@example.com")).toBe("O");
  });

  it("returns only the warehouse-relevant group for the inventory grant set", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/tasks",
      grants: DEFAULT_ROLE_GRANTS.inventory,
    });

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      title: "Fulfillment",
      sectionKey: "sections.fulfillment",
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
    ]);
    expect(groups[1]).toMatchObject({ title: "HR", sectionKey: "sections.hr" });
    expect(groups[1]?.items).toEqual([
      {
        titleKey: "pages.myLeave",
        href: "/ayam-norliza-pilot/leave",
        isActive: false,
      },
    ]);
  });

  it.each(["seller", "supervisor"] as const)(
    "returns the sales-side nav (no dashboard) for the %s grant set",
    (role) => {
      const groups = getDashboardSidebarGroups({
        organizationSlug: "ayam-norliza-pilot",
        pathname: "/ayam-norliza-pilot/delivery",
        grants: DEFAULT_ROLE_GRANTS[role],
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
      // loading only carries an `edit` grant for seller/supervisor (RPC-only
      // actions) — the page itself stays hidden from the nav.
      expect(groups[1]?.items.map((item) => item.titleKey)).toEqual([
        "pages.dispatch",
        "pages.deliveryRuns",
        "pages.driverRoster",
        "pages.deliverySetup",
      ]);

      const hrGroup = groups.find((group) => group.title === "HR");
      expect(hrGroup?.items.map((item) => item.titleKey)).toEqual(["pages.myLeave"]);
    },
  );

  it("gives the hr grant set both My Leave and Leave Management", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/leave/manage",
      grants: DEFAULT_ROLE_GRANTS.hr,
    });

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      title: "Fulfillment",
      sectionKey: "sections.fulfillment",
      isActive: false,
    });
    expect(groups[0]?.items).toEqual([
      {
        titleKey: "pages.driverRoster",
        href: "/ayam-norliza-pilot/roster",
        isActive: false,
      },
    ]);
    expect(groups[1]).toMatchObject({
      title: "HR",
      sectionKey: "sections.hr",
      isActive: true,
    });
    expect(groups[1]?.items).toEqual([
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

  it("gives the driver grant set the way back to the deck, then My Leave", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/leave",
      grants: DEFAULT_ROLE_GRANTS.driver,
    });

    expect(groups.map((g) => g.title)).toEqual(["Driving", "HR"]);
    expect(groups[0]?.items).toEqual([
      {
        titleKey: "pages.driverDeck",
        href: "/drive/ayam-norliza-pilot",
        isActive: false,
      },
    ]);
    expect(groups[1]?.items).toEqual([
      {
        titleKey: "pages.myLeave",
        href: "/ayam-norliza-pilot/leave",
        isActive: true,
      },
    ]);
  });

  it("hides the driver deck from the office even though owner/admin hold the grant", () => {
    for (const role of ["owner", "org_admin"] as const) {
      const groups = getDashboardSidebarGroups({
        organizationSlug: "ayam-norliza-pilot",
        pathname: "/ayam-norliza-pilot/runs",
        grants: DEFAULT_ROLE_GRANTS[role],
      });
      expect(groups.map((g) => g.title)).not.toContain("Driving");
    }
  });

  it("shows the owner the HR group including Leave Management", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/leave/manage",
      grants: DEFAULT_ROLE_GRANTS.owner,
    });

    const hrGroup = groups.find((group) => group.title === "HR");
    expect(hrGroup?.sectionKey).toBe("sections.hr");
    expect(hrGroup?.items).toEqual([
      {
        titleKey: "pages.myLeave",
        href: "/ayam-norliza-pilot/leave",
        isActive: true,
      },
      {
        titleKey: "pages.leaveManagement",
        href: "/ayam-norliza-pilot/leave/manage",
        isActive: true,
      },
    ]);
  });

  it("splits sales and fulfillment into separate groups", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/dispatch",
      grants: DEFAULT_ROLE_GRANTS.owner,
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
      "pages.driverRoster",
      "pages.deliverySetup",
    ]);
  });

  it("shows the Data console group to org_admin only, not owner", () => {
    const adminGroups = getDashboardSidebarGroups({
      organizationSlug: "org",
      pathname: "/org/data-console",
      grants: DEFAULT_ROLE_GRANTS.org_admin,
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

    for (const grants of [DEFAULT_ROLE_GRANTS.owner, DEFAULT_ROLE_GRANTS.seller, new Set<string>()]) {
      const groups = getDashboardSidebarGroups({
        organizationSlug: "org",
        pathname: "/org/products",
        grants,
      });
      expect(groups.find((g) => g.title === "System")).toBeUndefined();
    }
  });
});
