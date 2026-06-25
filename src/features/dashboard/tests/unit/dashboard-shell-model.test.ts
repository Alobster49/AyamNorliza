import { describe, expect, it } from "vitest";
import {
  getDashboardPageContext,
  getDashboardSidebarGroups,
  getUserInitials,
} from "../../components/dashboard-shell-model";

describe("dashboard shell model", () => {
  it("marks overview as the active operations route", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/overview",
    });

    expect(groups[0]).toMatchObject({
      title: "Operations",
      isActive: true,
      items: [
        expect.objectContaining({
          title: "Overview",
          href: "/ayam-norliza-pilot/overview",
          isActive: true,
        }),
        expect.objectContaining({
          title: "Alerts",
          href: "/ayam-norliza-pilot/alerts",
          isActive: false,
        }),
      ],
    });
    expect(groups[1]).toMatchObject({
      title: "Access control",
      isActive: false,
    });
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

  it("formats fallback user initials from display name or email", () => {
    expect(getUserInitials("Ayam Norliza", "owner@example.com")).toBe("AN");
    expect(getUserInitials("", "owner@example.com")).toBe("O");
  });
});
