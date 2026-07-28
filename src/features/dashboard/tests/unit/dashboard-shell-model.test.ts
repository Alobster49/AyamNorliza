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
});
