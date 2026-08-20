import { describe, expect, it } from "vitest";
import {
  getDashboardPageContext,
  getDashboardSidebarGroups,
  getUserInitials,
} from "../../components/dashboard-shell-model";

describe("dashboard shell model", () => {
  it("marks organization settings as the active sidebar item", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/settings/organization",
    });

    expect(groups[0]).toMatchObject({
      title: "Access control",
      isActive: true,
    });
    const orgItem = groups[0]?.items.find((item) => item.title === "Organization");
    expect(orgItem).toMatchObject({
      title: "Organization",
      href: "/ayam-norliza-pilot/settings/organization",
      isActive: true,
    });
  });

  it("marks users as the active sidebar item", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/settings/users",
    });

    expect(groups[0]).toMatchObject({ title: "Access control", isActive: true });
  });

  it("returns page context for nested access control routes", () => {
    expect(
      getDashboardPageContext({
        organizationSlug: "ayam-norliza-pilot",
        pathname: "/ayam-norliza-pilot/settings/support-sessions/active",
      }),
    ).toEqual({
      section: "Access control",
      title: "Support sessions",
    });
  });

  it("returns access control as default page context for unknown routes", () => {
    expect(
      getDashboardPageContext({
        organizationSlug: "ayam-norliza-pilot",
        pathname: "/ayam-norliza-pilot/unknown",
      }),
    ).toEqual({
      section: "Access control",
      title: "Organization",
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
    expect(groups[0]).toMatchObject({ title: "Warehouse", isActive: true });
    expect(groups[0]?.items).toEqual([
      {
        title: "Warehouse tasks",
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
    expect(groups[0]?.items[0]).toMatchObject({ isActive: false });
    expect(groups[0]?.items).toEqual([
      {
        title: "Warehouse tasks",
        href: "/ayam-norliza-pilot/tasks",
        isActive: false,
      },
      {
        title: "Dispatch",
        href: "/ayam-norliza-pilot/dispatch",
        isActive: false,
      },
      {
        title: "Loading",
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
    const salesTitles = groups[1]?.items.map((item) => item.title);
    expect(salesTitles).toEqual([
      "Products",
      "Orders",
      "Customers",
      "Delivery setup",
      "Dispatch",
      "Loading",
      "Delivery runs",
      "Warehouse tasks",
    ]);
    const deliverySetup = groups[1]?.items.find((item) => item.title === "Delivery setup");
    expect(deliverySetup).toMatchObject({
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
    const runsItem = groups[1]?.items.find((item) => item.title === "Delivery runs");
    expect(runsItem).toMatchObject({
      href: "/ayam-norliza-pilot/runs",
      isActive: true,
    });
  });
});
