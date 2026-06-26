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
          title: "Flocks",
          href: "/ayam-norliza-pilot/flocks",
          isActive: false,
        }),
        expect.objectContaining({
          title: "Alerts",
          href: "/ayam-norliza-pilot/alerts",
          isActive: false,
        }),
      ],
    });
    expect(groups[1]).toMatchObject({
      title: "Daily ops",
      isActive: false,
    });
    expect(groups[2]).toMatchObject({
      title: "Farm setup",
      isActive: false,
    });
    expect(groups[3]).toMatchObject({
      title: "Access control",
      isActive: false,
    });
  });

  it("marks today as the active daily operations route", () => {
    const groups = getDashboardSidebarGroups({
      organizationSlug: "ayam-norliza-pilot",
      pathname: "/ayam-norliza-pilot/today",
    });

    expect(groups[1]).toMatchObject({
      title: "Daily ops",
      isActive: true,
      items: expect.arrayContaining([
        expect.objectContaining({
          title: "Today",
          href: "/ayam-norliza-pilot/today",
          isActive: true,
        }),
      ]),
    });
  });

  it("returns page context for nested farm setup routes", () => {
    expect(
      getDashboardPageContext({
        organizationSlug: "ayam-norliza-pilot",
        pathname: "/ayam-norliza-pilot/settings/sites/11111111-1111-1111-1111-111111111111",
      }),
    ).toEqual({
      section: "Farm setup",
      title: "Sites",
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
